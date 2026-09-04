import { createHmac } from "node:crypto";

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export const TOTP_ALGORITHMS: TotpAlgorithm[] = ["SHA1", "SHA256", "SHA512"];

export type HotpOptions = {
  secret: Uint8Array;
  counter: number;
  digits: number;
  algorithm: TotpAlgorithm;
};

/** RFC 4226 §5.3 — dynamic truncation. */
export const hotp = ({ secret, counter, digits, algorithm }: HotpOptions): string => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm.toLowerCase(), secret).update(message).digest();

  // The low nibble of the last byte picks the 4-byte window to read.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;

  return String(binary % 10 ** digits).padStart(digits, "0");
};

/** RFC 6238 — the counter is elapsed time steps since the Unix epoch. */
export const counterAt = (atMs: number, period: number): number => Math.floor(atMs / 1000 / period);

export type TotpOptions = {
  secret: Uint8Array;
  digits?: number;
  period?: number;
  algorithm?: TotpAlgorithm;
  /** Milliseconds since the epoch. Injected so tests can pin RFC 6238 vectors. */
  atMs?: number;
};

export const totp = (opts: TotpOptions): string =>
  hotp({
    secret: opts.secret,
    counter: counterAt(opts.atMs ?? Date.now(), opts.period ?? 30),
    digits: opts.digits ?? 6,
    algorithm: opts.algorithm ?? "SHA1",
  });

/** How long the code minted at `atMs` stays valid. Never 0, so a caller never reports "expires now". */
export const secondsRemaining = (atMs: number, period: number): number =>
  period - (Math.floor(atMs / 1000) % period);
