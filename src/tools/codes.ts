import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { base32Decode } from "#/core/base32";
import type { SeedStore } from "#/core/store";
import { secondsRemaining, totp } from "#/core/totp";
import type { ToolContext } from "#/tools/index";
import { labelArg, wrap } from "#/tools/util";

export const registerCodeTools = (server: McpServer, store: SeedStore, ctx: ToolContext): void => {
  server.registerTool(
    "totp_list",
    {
      title: "TOTP: List Seeds",
      description:
        `List the registered seeds — label, issuer, account and parameters — and where ` +
        `each one is stored. Never returns a secret. A seed whose keychain item has gone ` +
        `missing is listed with a "problem" field rather than omitted, so a broken entry ` +
        `is visible instead of silently absent.`,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => wrap(async () => ({ seeds: await store.list() })),
  );

  server.registerTool(
    "totp_get_code",
    {
      title: "TOTP: Get Verification Code",
      description:
        `Mint the current verification code for a registered seed.\n\n` +
        `The returned code lands in the conversation transcript, which is a real cost: ` +
        `it is a bearer-equivalent second factor, valid for the seconds reported in ` +
        `"seconds_remaining". Prefer wiring the seed directly into the server that needs ` +
        `it — mcp-npm reads the same store through NPM_OTP_MODE=totp and never surfaces ` +
        `the code at all. Use this tool for services with no such integration.\n\n` +
        `If "seconds_remaining" is very low, the code is about to roll over; pass ` +
        `"wait_for_fresh": true to get one from the next window instead of a code that ` +
        `expires before it can be typed.`,
      inputSchema: z.object({
        label: labelArg,
        wait_for_fresh: z
          .boolean()
          .default(false)
          .describe(
            `Return a code with a full window ahead of it, waiting up to one period ` +
              `(usually 30 seconds) if the current one is about to expire. Defaults to false.`,
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ label, wait_for_fresh }) =>
      wrap(async () => {
        const seed = await store.get(label);
        const secret = base32Decode(seed.secret);

        let atMs = ctx.now();
        let remaining = secondsRemaining(atMs, seed.period);
        if (wait_for_fresh && remaining < seed.period) {
          // Step to the start of the next window rather than sleeping the clock
          // forward, so the wait is exactly the rollover and never longer.
          await new Promise((resolve) => setTimeout(resolve, remaining * 1000));
          atMs = ctx.now();
          remaining = secondsRemaining(atMs, seed.period);
        }

        return {
          label: seed.label,
          issuer: seed.issuer,
          account: seed.account,
          code: totp({
            secret,
            digits: seed.digits,
            period: seed.period,
            algorithm: seed.algorithm,
            atMs,
          }),
          seconds_remaining: remaining,
          source: seed.source,
        };
      }),
  );
};
