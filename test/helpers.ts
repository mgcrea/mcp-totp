import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { loadConfig, type Config } from "#/config";
import type { KeychainStore } from "#/core/keychain";
import { createServer } from "#/server";

/**
 * ⚠ This server reads no credential file — seeds come from the environment or
 * the macOS keychain, and both are injected below. The real keychain is NEVER
 * touched by the suite: `connect()` defaults to the in-memory double, so a test
 * can neither read the developer's own seeds nor write into their login
 * keychain (which would survive the test run and outlive the machine's patience).
 */
export type MemoryKeychain = KeychainStore & {
  items: Map<string, string>;
  reads: string[];
};

export const memoryKeychain = (
  initial: Record<string, string> = {},
  opts: { available?: boolean } = {},
): MemoryKeychain => {
  const items = new Map(Object.entries(initial));
  const reads: string[] = [];
  const available = opts.available ?? true;
  return {
    items,
    reads,
    available: () => available,
    read: async (account) => {
      reads.push(account);
      return items.get(account);
    },
    write: async (account, secret) => {
      items.set(account, secret);
    },
    remove: async (account) => items.delete(account),
  };
};

/** An RFC 6238 SHA-1 seed: the ASCII bytes "12345678901234567890", base32-encoded. */
export const RFC_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

export const otpauthUri = (
  secret = RFC_SECRET_BASE32,
  extra: Record<string, string> = {},
): string => {
  const params = new URLSearchParams({ secret, issuer: "npm", ...extra });
  return `otpauth://totp/npm:alice?${params.toString()}`;
};

export type ConnectOptions = {
  keychain?: KeychainStore;
  /** Frozen clock, so a minted code is deterministic. */
  nowMs?: number;
  openUri?: (uri: string) => Promise<void>;
};

export const connect = async (env: Record<string, string> = {}, opts: ConnectOptions = {}) => {
  const config: Config = loadConfig(env);
  const keychain = opts.keychain ?? memoryKeychain();
  const opened: string[] = [];

  const { server, store } = createServer({
    config,
    env,
    keychain,
    now: () => opts.nowMs ?? Date.now(),
    openUri:
      opts.openUri ??
      (async (uri) => {
        opened.push(uri);
      }),
  });

  // Both halves of a linked pair must come from the SAME package: v2 exports
  // InMemoryTransport from both /client and /server, and the two copies keep
  // private state that does not cross. Mixing them makes the pair hang rather
  // than fail, which is a miserable thing to debug.
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    store,
    keychain,
    opened,
    toolNames: async (): Promise<string[]> =>
      (await client.listTools()).tools.map((t) => t.name).toSorted(),
    tool: async (name: string) => (await client.listTools()).tools.find((t) => t.name === name),
    call: async (name: string, args: Record<string, unknown> = {}) => {
      // A schema violation is rejected by the SDK at the protocol layer and
      // never reaches the tool body — which is the behaviour we want, so the
      // harness reports it as an error rather than failing to parse it.
      let res;
      try {
        res = await client.callTool({ name, arguments: args });
      } catch (err) {
        return { isToolError: true, rejected: true, error: String(err) } as Record<string, unknown>;
      }
      const text = (res.content as { type: string; text: string }[])[0]?.text ?? "{}";
      try {
        return { ...JSON.parse(text), isToolError: res.isError === true } as Record<
          string,
          unknown
        >;
      } catch {
        return { isToolError: res.isError === true, error: text } as Record<string, unknown>;
      }
    },
  };
};
