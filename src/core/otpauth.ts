import { base32Decode } from "#/core/base32";
import { InvalidSeedError } from "#/core/errors";
import { TOTP_ALGORITHMS, type TotpAlgorithm } from "#/core/totp";

/** Everything needed to mint a code, minus the local storage label. */
export type SeedParams = {
  issuer: string | undefined;
  account: string;
  /** Base32, kept exactly as written so a round-trip through the URI is lossless. */
  secret: string;
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
};

export type Seed = SeedParams & {
  /** The local name this seed is addressed by, e.g. "npm". */
  label: string;
};

const DEFAULTS = { digits: 6, period: 30, algorithm: "SHA1" as const };

const intParam = (
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new InvalidSeedError(
      `"${name}" must be an integer between ${min} and ${max}, got "${raw}".`,
    );
  }
  return n;
};

/**
 * Parse an `otpauth://totp/...` URI, the format every authenticator and QR code
 * speaks — and the one Passwords.app itself claims as the default handler, which
 * is what lets the same seed be shared with it.
 *
 * HOTP is rejected rather than silently treated as TOTP: an HOTP seed has a
 * stored counter, and minting from it here would desynchronise the real one.
 */
export const parseOtpAuthUri = (uri: string): SeedParams => {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new InvalidSeedError(`Not a URI: "${uri.slice(0, 40)}".`);
  }
  if (url.protocol !== "otpauth:") {
    throw new InvalidSeedError(`Expected an otpauth:// URI, got "${url.protocol}//".`);
  }
  if (url.host !== "totp") {
    throw new InvalidSeedError(
      url.host === "hotp"
        ? `HOTP is not supported: it is counter-based, and minting a code here would ` +
            `desynchronise the counter held by the real authenticator.`
        : `Expected otpauth://totp/, got otpauth://${url.host}/.`,
    );
  }

  // Split on the RAW path, then decode each half. Decoding first would merge an
  // issuer that legitimately contains an encoded colon ("Acme%3A Ops:alice")
  // into the account, and the split would land in the wrong place.
  const rawPath = url.pathname.replace(/^\//, "");
  const sep = rawPath.indexOf(":");
  const pathIssuer = sep === -1 ? undefined : decodeURIComponent(rawPath.slice(0, sep)).trim();
  const account = decodeURIComponent(sep === -1 ? rawPath : rawPath.slice(sep + 1)).trim();

  const secret = url.searchParams.get("secret")?.trim();
  if (!secret) throw new InvalidSeedError(`The URI has no "secret" parameter.`);
  base32Decode(secret); // validate now, so a bad seed fails at import rather than at mint

  const algorithmRaw = (url.searchParams.get("algorithm") ?? DEFAULTS.algorithm).toUpperCase();
  const algorithm = TOTP_ALGORITHMS.find((a) => a === algorithmRaw);
  if (!algorithm) {
    throw new InvalidSeedError(
      `Unsupported algorithm "${algorithmRaw}". Expected one of ${TOTP_ALGORITHMS.join(", ")}.`,
    );
  }

  const issuer = url.searchParams.get("issuer")?.trim() || pathIssuer || undefined;

  return {
    issuer,
    account,
    secret,
    digits: intParam(url.searchParams, "digits", DEFAULTS.digits, 6, 10),
    period: intParam(url.searchParams, "period", DEFAULTS.period, 1, 120),
    algorithm,
  };
};

export const buildOtpAuthUri = (seed: SeedParams): string => {
  const path = seed.issuer
    ? `${encodeURIComponent(seed.issuer)}:${encodeURIComponent(seed.account)}`
    : encodeURIComponent(seed.account);
  const params = new URLSearchParams({
    secret: seed.secret,
    algorithm: seed.algorithm,
    digits: String(seed.digits),
    period: String(seed.period),
  });
  if (seed.issuer) params.set("issuer", seed.issuer);
  return `otpauth://totp/${path}?${params.toString()}`;
};

/**
 * Accept either a full URI or a bare base32 secret. The bare form is what a user
 * copying npm's "setup key" out of a web page actually has in the clipboard.
 */
export const parseSeedInput = (input: string, fallbackAccount: string): SeedParams => {
  const trimmed = input.trim();
  if (/^otpauth:/i.test(trimmed)) return parseOtpAuthUri(trimmed);
  base32Decode(trimmed);
  return {
    issuer: undefined,
    account: fallbackAccount,
    secret: trimmed,
    digits: DEFAULTS.digits,
    period: DEFAULTS.period,
    algorithm: DEFAULTS.algorithm,
  };
};
