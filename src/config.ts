import { z } from "zod";

import { ENV_SEED_PREFIX } from "#/core/store";

const ConfigSchema = z
  .object({
    /** Keychain generic-password service every seed is filed under. */
    keychainService: z.string().min(1).default("com.mgcrea.mcp-totp"),
    allowWrites: z.boolean().default(false),
  })
  .strict()
  .superRefine((_cfg, _ctx) => {
    // Deliberately NOT an error when no seeds are registered. An MCP server that
    // exits on startup shows up in the client as a bare "Connection closed",
    // with stderr swallowed — so the one message that would have explained the
    // problem never reaches anyone. Report it through totp_auth_status instead.
  });

export type Config = z.infer<typeof ConfigSchema>;

/** Maps "" to undefined, so an empty env var means "unset" rather than "empty". */
const trimmed = (value: string | undefined): string | undefined => {
  const t = value?.trim();
  return t ? t : undefined;
};

const parseBool = (value: string | undefined): boolean | undefined => {
  const t = trimmed(value);
  if (t === undefined) return undefined;
  return ["1", "true", "yes", "on"].includes(t.toLowerCase());
};

/**
 * Environment first — there is no config file here on purpose. The only thing
 * worth persisting is a seed, and a seed belongs in the keychain rather than in
 * a JSON file that lands in backups and Time Machine.
 */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config =>
  ConfigSchema.parse({
    keychainService: trimmed(env.TOTP_KEYCHAIN_SERVICE),
    allowWrites: parseBool(env.TOTP_ALLOW_WRITES),
  });

export type SetupContext = {
  keychainAvailable: boolean;
  envSeedLabels: string[];
};

/** Returned by totp_auth_status and printed to stderr at startup. */
export const setupInstructions = (config: Config, ctx: SetupContext): string[] => {
  const lines: string[] = [];

  if (!ctx.keychainAvailable && ctx.envSeedLabels.length === 0) {
    lines.push(
      `No seed store is reachable: this is not macOS (or /usr/bin/security is missing), ` +
        `and no ${ENV_SEED_PREFIX}<LABEL> variable is set.`,
      `Set ${ENV_SEED_PREFIX}NPM to an otpauth:// URI or a base32 secret, then restart.`,
    );
    return lines;
  }

  if (!config.allowWrites) {
    lines.push(
      `Writes are disabled, so seeds cannot be imported or removed. ` +
        `Set TOTP_ALLOW_WRITES=1 to enable totp_import_uri, totp_import_from_export and totp_remove.`,
    );
  }

  lines.push(
    `Seeds are read from ${ENV_SEED_PREFIX}<LABEL> first, then the "${config.keychainService}" ` +
      `keychain service. Call totp_list to see what is registered.`,
  );
  return lines;
};
