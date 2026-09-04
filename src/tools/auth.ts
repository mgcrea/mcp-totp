import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { setupInstructions } from "#/config";
import { ENV_SEED_PREFIX, type SeedStore } from "#/core/store";
import type { ToolContext } from "#/tools/index";
import { ok } from "#/tools/util";

/**
 * Registered unconditionally, and must never throw. It is the only tool a server
 * with no seeds and no keychain still offers, so it has to carry the whole setup
 * story as data rather than as an error.
 */
export const registerAuthTools = (server: McpServer, store: SeedStore, ctx: ToolContext): void => {
  server.registerTool(
    "totp_auth_status",
    {
      title: "TOTP: Status",
      description:
        `Report what this server can and cannot do: whether a seed store is reachable, ` +
        `which labels are registered and where each one comes from, and whether writes ` +
        `are enabled. Call this first when a tool you expected is missing — an absent ` +
        `tool means missing configuration rather than a bug.\n\n` +
        `Note what this server is NOT: it cannot read codes out of Passwords.app. No such ` +
        `interface exists — Passwords.app has no scripting dictionary and no App Intents, ` +
        `and its keychain items sit behind an Apple-private access group. This server ` +
        `holds its own copy of the seed and mints codes locally; totp_import_uri can hand ` +
        `the same seed to Passwords.app so both stay in sync.`,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      const envSeedLabels = Object.keys(process.env)
        .filter((key) => key.startsWith(ENV_SEED_PREFIX) && (process.env[key]?.trim() ?? "") !== "")
        .map((key) => key.slice(ENV_SEED_PREFIX.length).toLowerCase())
        .toSorted();

      const keychainAvailable = store.keychainAvailable();

      // Best-effort: a keychain that prompts or fails must still leave a usable
      // status reply, so the listing degrades to an error string instead of throwing.
      let seeds: unknown[] = [];
      let listError: string | undefined;
      try {
        seeds = await store.list();
      } catch (err) {
        listError = err instanceof Error ? err.message : String(err);
      }

      return ok({
        platform: process.platform,
        keychain_available: keychainAvailable,
        keychain_service: ctx.config.keychainService,
        writes: ctx.allowWrites ? "ENABLED" : "disabled",
        seed_count: seeds.length,
        seeds,
        ...(listError ? { list_error: listError } : {}),
        env_seed_labels: envSeedLabels,
        setup: setupInstructions(ctx.config, { keychainAvailable, envSeedLabels }),
      });
    },
  );
};
