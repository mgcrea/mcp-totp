import type { McpServer } from "@modelcontextprotocol/server";

import type { Config } from "#/config";
import type { UriOpener } from "#/core/passwords";
import type { SeedStore } from "#/core/store";
import { registerAuthTools } from "#/tools/auth";
import { registerCodeTools } from "#/tools/codes";
import { registerManageTools } from "#/tools/manage";

export type ToolContext = {
  config: Config;
  /** Register the mutating tools too. Off by default — see TOTP_ALLOW_WRITES. */
  allowWrites: boolean;
  /** A seed store is reachable at all: macOS keychain, or at least one env seed. */
  hasStore: boolean;
  openUri: UriOpener;
  now: () => number;
};

/**
 * Register the tools. Read tools are always registered; write tools are only
 * registered when `allowWrites` is set, so with the flag off they are not merely
 * refused — they are invisible, and cannot be called at all.
 */
export const registerTools = (server: McpServer, store: SeedStore, ctx: ToolContext): void => {
  // Always available: needs no seeds, so an unconfigured server can still explain
  // itself instead of closing the connection.
  registerAuthTools(server, store, ctx);

  if (!ctx.hasStore) return;

  registerCodeTools(server, store, ctx);

  if (ctx.allowWrites) registerManageTools(server, store, ctx);
};
