import { InvalidSeedError } from "#/core/errors";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * RFC 4648 base32, tolerant of the shapes authenticator apps actually emit:
 * lower case, spaces and dashes for readability, and missing "=" padding.
 * Padding is stripped rather than validated — every real QR code omits it, and
 * rejecting those would fail on correct input.
 */
export const base32Decode = (input: string): Uint8Array => {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (clean === "") throw new InvalidSeedError("The secret is empty.");

  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new InvalidSeedError(
        `The secret is not valid base32: unexpected character "${ch}". ` +
          `Expected only A-Z and 2-7.`,
      );
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length === 0) {
    throw new InvalidSeedError("The secret is too short to decode to any bytes.");
  }
  return Uint8Array.from(out);
};

export const base32Encode = (bytes: Uint8Array): string => {
  let out = "";
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
};
