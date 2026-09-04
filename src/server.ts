import { McpServer } from "@modelcontextprotocol/server";

import { BUILD_INFO } from "#/build-info";
import type { Config } from "#/config";
import { createKeychainStore, type KeychainStore } from "#/core/keychain";
import type { Logger } from "#/core/logger";
import { createUriOpener, type UriOpener } from "#/core/passwords";
import { createSeedStore, ENV_SEED_PREFIX, type SeedStore } from "#/core/store";
import { registerTools } from "#/tools/index";

export const SERVER_NAME = BUILD_INFO.name;
export const SERVER_VERSION = BUILD_INFO.version;

export type CreateServerOptions = {
  config: Config;
  logger?: Logger;
  /** Environment the seed store reads TOTP_SECRET_<LABEL> from. */
  env?: NodeJS.ProcessEnv;
  /** Override the keychain (tests). */
  keychain?: KeychainStore;
  /** Override the Passwords.app hand-off (tests). */
  openUri?: UriOpener;
  /** Injected clock, so RFC 6238 vectors can be pinned in tests. */
  now?: () => number;
};

export type CreatedServer = {
  server: McpServer;
  store: SeedStore;
};

export const createServer = (opts: CreateServerOptions): CreatedServer => {
  const { config } = opts;
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const env = opts.env ?? process.env;
  const keychain = opts.keychain ?? createKeychainStore(config.keychainService);
  const store = createSeedStore({ keychain, env });

  // The registration gate has to be synchronous, so it asks whether a store
  // exists at all rather than whether it holds anything. An empty-but-present
  // keychain still registers the seed tools, and totp_get_code's error names the
  // registered labels — which is a better setup instruction than a vanished tool.
  const hasStore =
    keychain.available() ||
    Object.keys(env).some(
      (key) => key.startsWith(ENV_SEED_PREFIX) && (env[key]?.trim() ?? "") !== "",
    );

  registerTools(server, store, {
    config,
    allowWrites: config.allowWrites,
    hasStore,
    openUri: opts.openUri ?? createUriOpener(),
    now: opts.now ?? (() => Date.now()),
  });

  return { server, store };
};
