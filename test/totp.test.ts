import { describe, expect, it } from "vitest";

import { base32Decode, base32Encode } from "#/core/base32";
import { InvalidSeedError } from "#/core/errors";
import { buildOtpAuthUri, parseOtpAuthUri, parseSeedInput } from "#/core/otpauth";
import { secondsRemaining, totp, type TotpAlgorithm } from "#/core/totp";

/**
 * RFC 6238 Appendix B. These are the real correctness proof for this server:
 * deterministic, credential-free, and they fail loudly if anything about the
 * HMAC, the counter derivation or the dynamic truncation drifts.
 */
describe("RFC 6238 test vectors", () => {
  const seeds: Record<TotpAlgorithm, Uint8Array> = {
    SHA1: Buffer.from("12345678901234567890"),
    SHA256: Buffer.from("12345678901234567890123456789012"),
    SHA512: Buffer.from("1234567890123456789012345678901234567890123456789012345678901234"),
  };

  const vectors: [seconds: number, algorithm: TotpAlgorithm, expected: string][] = [
    [59, "SHA1", "94287082"],
    [59, "SHA256", "46119246"],
    [59, "SHA512", "90693936"],
    [1111111109, "SHA1", "07081804"],
    [1111111109, "SHA256", "68084774"],
    [1111111109, "SHA512", "25091201"],
    [1111111111, "SHA1", "14050471"],
    [1234567890, "SHA1", "89005924"],
    [2000000000, "SHA1", "69279037"],
    [20000000000, "SHA1", "65353130"],
    [20000000000, "SHA512", "47863826"],
  ];

  for (const [seconds, algorithm, expected] of vectors) {
    it(`${algorithm} at T=${seconds} is ${expected}`, () => {
      expect(
        totp({ secret: seeds[algorithm], algorithm, digits: 8, period: 30, atMs: seconds * 1000 }),
      ).toBe(expected);
    });
  }

  it("defaults to 6 digits, 30 seconds, SHA-1 — what every service assumes", () => {
    expect(totp({ secret: seeds.SHA1, atMs: 59_000 })).toBe("287082");
  });
});

describe("secondsRemaining", () => {
  it("never reports zero, so a caller never hands out a code that is already dead", () => {
    for (let t = 0; t < 120; t += 1) {
      const remaining = secondsRemaining(t * 1000, 30);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(30);
    }
  });

  it("counts down within a window", () => {
    expect(secondsRemaining(0, 30)).toBe(30);
    expect(secondsRemaining(29_000, 30)).toBe(1);
    expect(secondsRemaining(30_000, 30)).toBe(30);
  });
});

describe("base32", () => {
  it("matches RFC 4648", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(Buffer.from(base32Decode("MZXW6YTBOI======")).toString()).toBe("foobar");
  });

  it("decodes the RFC 6238 seed", () => {
    expect(Buffer.from(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")).toString()).toBe(
      "12345678901234567890",
    );
  });

  it("tolerates the shapes real QR codes emit: lower case, spaces, dashes, no padding", () => {
    const canonical = base32Decode("MZXW6YTBOI");
    expect(base32Decode("mzxw 6ytb-oi")).toEqual(canonical);
  });

  it("rejects a non-base32 character rather than silently decoding garbage", () => {
    expect(() => base32Decode("MZXW6YTB01")).toThrow(InvalidSeedError);
  });
});

describe("otpauth URIs", () => {
  it("parses issuer, account and parameters", () => {
    const seed = parseOtpAuthUri(
      "otpauth://totp/npm:alice?secret=MZXW6YTBOI&issuer=npm&digits=8&period=60&algorithm=SHA256",
    );
    expect(seed).toEqual({
      issuer: "npm",
      account: "alice",
      secret: "MZXW6YTBOI",
      digits: 8,
      period: 60,
      algorithm: "SHA256",
    });
  });

  it("falls back to the label prefix when there is no issuer parameter", () => {
    expect(parseOtpAuthUri("otpauth://totp/GitHub:bob?secret=MZXW6YTBOI").issuer).toBe("GitHub");
  });

  it("round-trips through buildOtpAuthUri without losing a parameter", () => {
    const original = parseOtpAuthUri(
      "otpauth://totp/npm:alice?secret=MZXW6YTBOI&issuer=npm&digits=8&period=60&algorithm=SHA512",
    );
    expect(parseOtpAuthUri(buildOtpAuthUri(original))).toEqual(original);
  });

  it("round-trips an issuer containing a colon and spaces", () => {
    const original = parseOtpAuthUri(
      `otpauth://totp/${encodeURIComponent("Acme: Ops")}:${encodeURIComponent("a@b.co")}` +
        `?secret=MZXW6YTBOI`,
    );
    expect(original.account).toBe("a@b.co");
    expect(parseOtpAuthUri(buildOtpAuthUri(original))).toEqual(original);
  });

  // Counter-based seeds must not be quietly treated as time-based: minting here
  // would desynchronise the counter held by the real authenticator.
  it("rejects HOTP", () => {
    expect(() => parseOtpAuthUri("otpauth://hotp/npm:alice?secret=MZXW6YTBOI&counter=1")).toThrow(
      /HOTP is not supported/,
    );
  });

  it("rejects a URI with no secret, and a bad secret, at import time", () => {
    expect(() => parseOtpAuthUri("otpauth://totp/npm:alice")).toThrow(/no "secret"/);
    expect(() => parseOtpAuthUri("otpauth://totp/npm:alice?secret=NOT!BASE32")).toThrow(
      InvalidSeedError,
    );
  });

  it("rejects out-of-range digits and period", () => {
    expect(() => parseOtpAuthUri("otpauth://totp/x?secret=MZXW6YTBOI&digits=4")).toThrow(/digits/);
    expect(() => parseOtpAuthUri("otpauth://totp/x?secret=MZXW6YTBOI&period=0")).toThrow(/period/);
  });

  it("accepts a bare base32 setup key, which is what a user actually copies", () => {
    expect(parseSeedInput("  mzxw 6ytb-oi ", "npm")).toEqual({
      issuer: undefined,
      account: "npm",
      secret: "mzxw 6ytb-oi",
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    });
  });
});
