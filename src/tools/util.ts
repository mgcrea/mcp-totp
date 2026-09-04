import { z } from "zod";

import {
  InvalidSeedError,
  KeychainError,
  UnknownSeedError,
  WritesDisabledError,
} from "#/core/errors";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }) }],
});

/**
 * Return text as-is. `ok()` JSON-stringifies, which turns a markdown document
 * into one escaped "# Title\n\n…" line that no one can read.
 */
export const okText = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
});

export const fail = (message: string, extra?: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify({ error: message, ...extra }) }],
  isError: true,
});

/**
 * Render a thrown value as a tool error. `remedy` is lifted to a TOP-LEVEL field
 * rather than buried under `details`, because that is the half a model acts on.
 */
export const toFailure = (err: unknown): ToolResult => {
  if (err instanceof UnknownSeedError) {
    return fail(err.message, {
      label: err.label,
      remedy: `Call totp_list to see the registered labels.`,
    });
  }
  if (err instanceof InvalidSeedError) return fail(err.message);
  if (err instanceof KeychainError) {
    return fail(err.message, {
      ...(err.exitCode === undefined ? {} : { security_exit_code: err.exitCode }),
      remedy: `Check that the login keychain is unlocked and that a keychain prompt was not denied.`,
    });
  }
  if (err instanceof WritesDisabledError) {
    return fail(err.message, { remedy: `Set TOTP_ALLOW_WRITES=1 and restart the server.` });
  }
  if (err instanceof Error) return fail(err.message);
  return fail("Unknown error", { details: String(err) });
};

/** Run a tool body, JSON-formatting the result and turning errors into a tool error. */
export const wrap = async <T>(fn: () => Promise<T>): Promise<ToolResult> => {
  try {
    return ok(await fn());
  } catch (err) {
    return toFailure(err);
  }
};

/** Like `wrap`, but the body chooses its own result shape (e.g. raw markdown). */
export const wrapResult = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await fn();
  } catch (err) {
    return toFailure(err);
  }
};

export const labelArg = z
  .string()
  .min(1)
  .describe(
    `The local name a seed is filed under, e.g. "npm". Lower-case letters, digits ` +
      `and underscores only, starting with a letter or digit. Call totp_list for the ` +
      `registered labels.`,
  );

/** Destructive tools require this, so an agent can never mutate something in passing. */
export const confirmArg = z
  .literal(true)
  .describe("Must be true. Explicit acknowledgement that this permanently deletes a seed.");
