import { readFile } from "node:fs/promises";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { parseExportCsv, previewOf } from "#/core/export-csv";
import { buildOtpAuthUri, parseSeedInput } from "#/core/otpauth";
import { assertLabel, type SeedStore } from "#/core/store";
import type { ToolContext } from "#/tools/index";
import { confirmArg, labelArg, wrap } from "#/tools/util";

const exportPathArg = z
  .string()
  .min(1)
  .describe(
    `Absolute path to a CSV exported from Passwords.app (File › Export All Passwords…). ` +
      `That file is plaintext and holds EVERY credential the user has — delete it as soon ` +
      `as the import is done.`,
  );

export const registerManageTools = (
  server: McpServer,
  store: SeedStore,
  ctx: ToolContext,
): void => {
  server.registerTool(
    "totp_import_uri",
    {
      title: "TOTP: Import Seed",
      description:
        `Register a TOTP seed from an otpauth:// URI or a bare base32 setup key, storing ` +
        `it in the macOS login keychain.\n\n` +
        `The intended source is the moment a service first hands you the seed — for npm, ` +
        `"npm profile enable-2fa auth-and-writes" prints an otpauth:// URI. Pass ` +
        `"share_with_passwords_app": true and the same seed is handed to Passwords.app ` +
        `through the otpauth:// scheme it registers, so the user's phone and Mac keep ` +
        `working normally. That hand-off is one-way by necessity: nothing can read a code ` +
        `back out of Passwords.app.\n\n` +
        `Storing a seed here means the second factor now lives on the same machine as the ` +
        `credential it protects. That is the deliberate trade for unattended publishing, ` +
        `and it is the reason this tool sits behind TOTP_ALLOW_WRITES.`,
      inputSchema: z.object({
        label: labelArg,
        uri: z
          .string()
          .min(1)
          .describe(
            `Either a full "otpauth://totp/npm:alice?secret=JBSWY3DPEHPK3PXP&issuer=npm" ` +
              `URI, or just the base32 setup key. HOTP URIs are rejected: they are ` +
              `counter-based, and minting here would desynchronise the real authenticator.`,
          ),
        share_with_passwords_app: z
          .boolean()
          .default(false)
          .describe(
            `Also hand the seed to Passwords.app via its otpauth:// URL scheme, which ` +
              `opens an import sheet the user confirms. Defaults to false.`,
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ label, uri, share_with_passwords_app }) =>
      wrap(async () => {
        assertLabel(label);
        const params = parseSeedInput(uri, label);
        await store.put(label, params);
        if (share_with_passwords_app) await ctx.openUri(buildOtpAuthUri(params));
        return {
          imported: label,
          issuer: params.issuer,
          account: params.account,
          digits: params.digits,
          period: params.period,
          algorithm: params.algorithm,
          shared_with_passwords_app: share_with_passwords_app,
          note:
            `Stored in the "${ctx.config.keychainService}" keychain service. The secret is ` +
            `never returned by any tool.`,
        };
      }),
  );

  server.registerTool(
    "totp_scan_export",
    {
      title: "TOTP: Scan Passwords Export",
      description:
        `List the verification-code entries in a Passwords.app CSV export, WITHOUT ` +
        `importing anything and without ever returning a password, note or secret — only ` +
        `title, issuer, account and a suggested label.\n\n` +
        `Use this when the seed cannot be re-issued (you do not want to rotate the ` +
        `service's 2FA). Pick an index from the result and pass it to ` +
        `totp_import_from_export. Producing the export itself is a manual step: it needs ` +
        `the Passwords.app UI and a biometric confirmation, and cannot be driven from here.`,
      inputSchema: z.object({ file_path: exportPathArg }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ file_path }) =>
      wrap(async () => {
        const entries = parseExportCsv(await readFile(file_path, "utf8"));
        return {
          entries: entries.map(previewOf),
          count: entries.length,
          note:
            `No secrets are shown here by design. Import one with totp_import_from_export, ` +
            `then delete ${file_path} — it is a plaintext copy of every credential.`,
        };
      }),
  );

  server.registerTool(
    "totp_import_from_export",
    {
      title: "TOTP: Import Seed From Export",
      description:
        `Import one entry from a Passwords.app CSV export, chosen by the index reported by ` +
        `totp_scan_export. Only the verification-code seed is read; the password and notes ` +
        `columns are never touched.\n\n` +
        `Indexes come from the same file, so re-run totp_scan_export if the file changed. ` +
        `Delete the export afterwards.`,
      inputSchema: z.object({
        file_path: exportPathArg,
        index: z
          .number()
          .int()
          .nonnegative()
          .describe(`The "index" of the entry, as reported by totp_scan_export.`),
        label: labelArg,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ file_path, index, label }) =>
      wrap(async () => {
        assertLabel(label);
        const entries = parseExportCsv(await readFile(file_path, "utf8"));
        const entry = entries[index];
        if (!entry) {
          throw new Error(
            `No entry at index ${index}: the file holds ${entries.length} ` +
              `verification-code entr${entries.length === 1 ? "y" : "ies"}. ` +
              `Re-run totp_scan_export.`,
          );
        }
        await store.put(label, entry.params);
        return {
          imported: label,
          from: entry.title,
          issuer: entry.params.issuer,
          account: entry.params.account,
          note: `Delete ${file_path} now — it is a plaintext copy of every credential.`,
        };
      }),
  );

  server.registerTool(
    "totp_remove",
    {
      title: "TOTP: Remove Seed",
      description:
        `Permanently delete a seed from the keychain. Irreversible: unless the same seed ` +
        `still exists in Passwords.app or on a phone, the account's second factor is gone ` +
        `and has to be re-enrolled with the service. Seeds supplied through ` +
        `TOTP_SECRET_<LABEL> are not touched — unset the variable instead.`,
      inputSchema: z.object({ label: labelArg, confirm: confirmArg }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ label }) => wrap(async () => ({ removed: await store.remove(label), label })),
  );
};
