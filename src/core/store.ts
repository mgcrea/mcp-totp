import { InvalidSeedError, UnknownSeedError } from "#/core/errors";
import type { KeychainStore } from "#/core/keychain";
import { buildOtpAuthUri, parseSeedInput, type Seed, type SeedParams } from "#/core/otpauth";

export type SeedSource = "environment" | "keychain";

export type SeedRecord = Seed & { source: SeedSource };

/** What `totp_list` returns — deliberately never carries `secret`. */
export type SeedSummary = {
  label: string;
  issuer: string | undefined;
  account: string;
  digits: number;
  period: number;
  algorithm: string;
  source: SeedSource;
  /** Set when the index lists a label whose keychain item has gone missing. */
  problem?: string;
};

export const ENV_SEED_PREFIX = "TOTP_SECRET_";

/**
 * Labels must start alphanumeric and hold only `[a-z0-9_]`. Two reasons, both
 * load-bearing: it makes the mapping to `TOTP_SECRET_<LABEL>` bijective (so a
 * label listed from the environment is the same string you can look up), and it
 * keeps the internal `__index__` item unreachable as a user label.
 */
const LABEL_RE = /^[a-z0-9][a-z0-9_]*$/;

const INDEX_ACCOUNT = "__index__";

export const assertLabel = (label: string): void => {
  if (!LABEL_RE.test(label)) {
    throw new InvalidSeedError(
      `Invalid label "${label}". Use lower-case letters, digits and underscores, ` +
        `starting with a letter or digit — for example "npm" or "aws_root".`,
    );
  }
};

export const envVarFor = (label: string): string => `${ENV_SEED_PREFIX}${label.toUpperCase()}`;

export type SeedStoreOptions = {
  keychain: KeychainStore;
  env?: NodeJS.ProcessEnv;
};

export type SeedStore = {
  keychainAvailable: () => boolean;
  list: () => Promise<SeedSummary[]>;
  get: (label: string) => Promise<SeedRecord>;
  put: (label: string, params: SeedParams) => Promise<void>;
  remove: (label: string) => Promise<boolean>;
};

const summarize = (seed: Seed, source: SeedSource): SeedSummary => ({
  label: seed.label,
  issuer: seed.issuer,
  account: seed.account,
  digits: seed.digits,
  period: seed.period,
  algorithm: seed.algorithm,
  source,
});

export const createSeedStore = (opts: SeedStoreOptions): SeedStore => {
  const { keychain } = opts;
  const env = opts.env ?? process.env;

  /** Labels supplied through the environment, for Docker and CI where there is no keychain. */
  const envLabels = (): string[] =>
    Object.keys(env)
      .filter((key) => key.startsWith(ENV_SEED_PREFIX) && (env[key]?.trim() ?? "") !== "")
      .map((key) => key.slice(ENV_SEED_PREFIX.length).toLowerCase())
      .filter((label) => LABEL_RE.test(label));

  const readIndex = async (): Promise<string[]> => {
    if (!keychain.available()) return [];
    const raw = await keychain.read(INDEX_ACCOUNT);
    if (raw === undefined) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v): v is string => typeof v === "string" && LABEL_RE.test(v));
    } catch {
      // A corrupt index must not take the whole server down; the seeds are still
      // readable by label, they just stop being enumerable.
      return [];
    }
  };

  const writeIndex = async (labels: string[]): Promise<void> => {
    await keychain.write(
      INDEX_ACCOUNT,
      JSON.stringify([...new Set(labels)].toSorted()),
      "mcp-totp seed index",
    );
  };

  const fromEnv = (label: string): SeedRecord | undefined => {
    const raw = env[envVarFor(label)]?.trim();
    if (!raw) return undefined;
    return { label, source: "environment", ...parseSeedInput(raw, label) };
  };

  return {
    keychainAvailable: keychain.available,

    list: async () => {
      const out: SeedSummary[] = [];
      const seen = new Set<string>();

      for (const label of envLabels()) {
        const seed = fromEnv(label);
        if (!seed) continue;
        seen.add(label);
        out.push(summarize(seed, "environment"));
      }

      for (const label of await readIndex()) {
        // The environment wins, so a label present in both is reported once, as
        // the value that would actually be used.
        if (seen.has(label)) continue;
        seen.add(label);
        const raw = await keychain.read(label);
        if (raw === undefined) {
          out.push({
            label,
            issuer: undefined,
            account: "",
            digits: 0,
            period: 0,
            algorithm: "",
            source: "keychain",
            problem: "Listed in the index, but its keychain item is missing. Re-import it.",
          });
          continue;
        }
        try {
          out.push(summarize({ label, ...parseSeedInput(raw, label) }, "keychain"));
        } catch (err) {
          out.push({
            label,
            issuer: undefined,
            account: "",
            digits: 0,
            period: 0,
            algorithm: "",
            source: "keychain",
            problem: `Stored value could not be parsed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
        }
      }

      return out.toSorted((a, b) => a.label.localeCompare(b.label));
    },

    get: async (label) => {
      assertLabel(label);

      const fromEnvironment = fromEnv(label);
      if (fromEnvironment) return fromEnvironment;

      if (keychain.available()) {
        const raw = await keychain.read(label);
        if (raw !== undefined) {
          return { label, source: "keychain", ...parseSeedInput(raw, label) };
        }
      }

      const known = [...envLabels(), ...(await readIndex())].toSorted();
      throw new UnknownSeedError(label, [...new Set(known)]);
    },

    put: async (label, params) => {
      assertLabel(label);
      // Stored as a full otpauth:// URI rather than a bare secret, so digits,
      // period, algorithm and issuer travel with it — and so re-sharing the seed
      // with Passwords.app is a copy rather than a reconstruction.
      await keychain.write(label, buildOtpAuthUri(params), `mcp-totp seed (${label})`);
      await writeIndex([...(await readIndex()), label]);
    },

    remove: async (label) => {
      assertLabel(label);
      const removed = await keychain.remove(label);
      const index = await readIndex();
      if (index.includes(label)) await writeIndex(index.filter((l) => l !== label));
      return removed;
    },
  };
};
