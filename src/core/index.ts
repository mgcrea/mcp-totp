/**
 * The dependency-free half of this package, published as `@mgcrea/mcp-totp/core`
 * so other servers (notably `mcp-npm`) can mint codes without pulling in the MCP
 * SDK. Nothing under `src/core/` may import `@modelcontextprotocol/server` or zod.
 */
export { base32Decode, base32Encode } from "#/core/base32";
export { counterAt, hotp, secondsRemaining, totp, TOTP_ALGORITHMS } from "#/core/totp";
export type { HotpOptions, TotpAlgorithm, TotpOptions } from "#/core/totp";
export { buildOtpAuthUri, parseOtpAuthUri, parseSeedInput } from "#/core/otpauth";
export type { Seed, SeedParams } from "#/core/otpauth";
export { createKeychainStore } from "#/core/keychain";
export type { KeychainStore } from "#/core/keychain";
export { createUriOpener } from "#/core/passwords";
export type { UriOpener } from "#/core/passwords";
export { assertLabel, createSeedStore, ENV_SEED_PREFIX, envVarFor } from "#/core/store";
export type { SeedRecord, SeedSource, SeedStore, SeedSummary } from "#/core/store";
export {
  InvalidSeedError,
  KeychainError,
  UnknownSeedError,
  WritesDisabledError,
} from "#/core/errors";
