import { describe, expect, it } from "vitest";

import { parseExportCsv, previewOf } from "#/core/export-csv";

/** The shape Passwords.app writes, plus the rows that make it interesting. */
const APPLE_EXPORT = [
  "Title,URL,Username,Password,Notes,OTPAuth",
  "npm,https://npmjs.com,alice,hunter2,,otpauth://totp/npm:alice?secret=MZXW6YTBOI&issuer=npm",
  "Bank,https://bank.example,bob,s3cret!,no otp here,",
  '"Acme, Inc.",https://acme.test,carol,"pa,ss","a ""quoted"" note",otpauth://totp/Acme:carol?secret=MZXW6YTBOI',
  "Broken,https://x.test,dave,pw,,otpauth://totp/x?secret=NOT!BASE32",
].join("\n");

describe("Passwords.app CSV export", () => {
  it("returns only the OTP-bearing rows", () => {
    const entries = parseExportCsv(APPLE_EXPORT);
    expect(entries.map((e) => e.title)).toEqual(["npm", "Acme, Inc."]);
  });

  it("handles quoted fields containing commas, quotes and the password itself", () => {
    const [, acme] = parseExportCsv(APPLE_EXPORT);
    expect(acme?.params.account).toBe("carol");
    expect(acme?.params.issuer).toBe("Acme");
  });

  // One unparseable row must not hide every good one in a file the user cannot
  // easily edit by hand.
  it("skips a row whose otpauth URI is malformed", () => {
    expect(parseExportCsv(APPLE_EXPORT)).toHaveLength(2);
  });

  /**
   * The whole safety argument for these tools. An export is a plaintext copy of
   * every credential the user has, so what leaves this module must be provably
   * free of passwords, notes and secrets.
   */
  it("never leaks a password, a note or a secret through the preview", () => {
    const previews = JSON.stringify(parseExportCsv(APPLE_EXPORT).map(previewOf));
    for (const secret of ["hunter2", "s3cret!", "pa,ss", "quoted", "MZXW6YTBOI"]) {
      expect(previews).not.toContain(secret);
    }
  });

  it("suggests a usable label", () => {
    expect(parseExportCsv(APPLE_EXPORT).map((e) => previewOf(e).suggested_label)).toEqual([
      "npm",
      "acme",
    ]);
  });

  // Matching by header name rather than position is what stops a column reorder
  // from silently feeding the Password column into the seed parser.
  it("finds the OTP column wherever it sits", () => {
    const reordered = [
      "OTPAuth,Password,Title",
      "otpauth://totp/npm:alice?secret=MZXW6YTBOI,hunter2,npm",
    ].join("\n");
    const [entry] = parseExportCsv(reordered);
    expect(entry?.params.account).toBe("alice");
    expect(entry?.title).toBe("npm");
  });

  it("returns nothing for a file with no OTP column at all", () => {
    expect(parseExportCsv("Title,Password\nnpm,hunter2")).toEqual([]);
    expect(parseExportCsv("")).toEqual([]);
  });

  it("tolerates a BOM and CRLF line endings", () => {
    const withBom = `﻿Title,OTPAuth\r\nnpm,otpauth://totp/npm:alice?secret=MZXW6YTBOI\r\n`;
    expect(parseExportCsv(withBom)).toHaveLength(1);
  });
});
