import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { KeychainError } from "#/core/errors";

const execFileAsync = promisify(execFile);

const SECURITY = "/usr/bin/security";

/** `security` exits 44 for errSecItemNotFound. */
const ITEM_NOT_FOUND = 44;

/**
 * A keychain authorization dialog blocks the CLI with no tty and no timeout of
 * its own, which would wedge the whole MCP server behind a window the user may
 * never see. Every call is bounded so a prompt becomes an error instead.
 */
const TIMEOUT_MS = 15_000;

export type KeychainStore = {
  available: () => boolean;
  read: (account: string) => Promise<string | undefined>;
  write: (account: string, secret: string, description: string) => Promise<void>;
  remove: (account: string) => Promise<boolean>;
};

const isExecError = (
  err: unknown,
): err is Error & { code?: number; stderr?: string; killed?: boolean } => err instanceof Error;

/** Run `security`, mapping a timeout to the dialog that almost always causes it. */
const runSecurity = async (args: string[]): Promise<{ stdout: string; code: number }> => {
  try {
    const { stdout } = await execFileAsync(SECURITY, args, {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
    });
    return { stdout, code: 0 };
  } catch (err) {
    if (isExecError(err) && err.killed === true) {
      throw new KeychainError(
        `${SECURITY} ${args[0]} timed out after ${TIMEOUT_MS / 1000}s. That almost always ` +
          `means macOS raised a keychain authorization dialog and is waiting for an answer ` +
          `— look for it on screen, and allow it.`,
      );
    }
    if (isExecError(err) && typeof err.code === "number") {
      return { stdout: "", code: err.code };
    }
    throw new KeychainError(
      `Could not run ${SECURITY}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

/** Whether this machine has the login keychain this store is built on. */
const keychainAvailable = (): boolean => process.platform === "darwin" && existsSync(SECURITY);

/**
 * The macOS login keychain, reached through Apple's own `security` CLI so this
 * server stays pure TypeScript with no native addon and no third-party binary.
 *
 * Two properties of `security` worth knowing before changing anything here:
 *
 *  - **The secret is passed in argv**, because `add-generic-password` has no
 *    stdin form — its only alternative is an interactive tty prompt. So the seed
 *    is visible in `ps` output for the few milliseconds the call takes. That is
 *    a real (if small) exposure to any local process, and it is documented in
 *    the README rather than hidden.
 *  - **The ACL is pinned to `/usr/bin/security` itself** via `-T`. That is what
 *    makes later reads silent instead of raising a keychain prompt, and it is
 *    also the honest limit of this store: anything on the machine that can run
 *    `security` can read the seed back.
 */
export const createKeychainStore = (service: string): KeychainStore => {
  const ensure = (): void => {
    if (!keychainAvailable()) {
      throw new KeychainError(
        `The macOS keychain is only available on macOS with ${SECURITY} present ` +
          `(this is ${process.platform}). Supply seeds through TOTP_SECRET_<LABEL> instead.`,
      );
    }
  };

  return {
    available: keychainAvailable,

    read: async (account) => {
      ensure();
      const { stdout, code } = await runSecurity([
        "find-generic-password",
        "-s",
        service,
        "-a",
        account,
        "-w",
      ]);
      if (code === ITEM_NOT_FOUND) return undefined;
      if (code !== 0) {
        throw new KeychainError(
          `Reading the keychain item "${account}" failed (security exited ${code}). ` +
            `If a keychain prompt was denied, the item's access control no longer trusts ` +
            `${SECURITY}; re-import the seed to repair it.`,
          code,
        );
      }
      // Only the trailing newline `security` adds — never .trim(), which would
      // silently corrupt a secret that legitimately ended in whitespace.
      return stdout.replace(/\r?\n$/, "");
    },

    write: async (account, secret, description) => {
      ensure();
      // Delete-then-add, NOT `add-generic-password -U`.
      //
      // Observed on macOS 26.6 against a real login keychain: creating an item
      // and deleting one are silent, but MODIFYING an existing one raises a
      // keychain authorization dialog the first time — and with no tty the CLI
      // blocks on it forever, taking the server with it. (Once the user allows
      // it, `-U` does succeed silently; the dialog is a first-use gate, not a
      // permanent one. That is precisely why it must not be on this path: it
      // fires on a fresh install, which is the worst moment to hang.)
      //
      // Expressing a rewrite as one delete plus one add stays inside the two
      // operations that never prompt. The cost is a brief window where the item
      // does not exist; nothing here reads across that window.
      await runSecurity(["delete-generic-password", "-s", service, "-a", account]);
      const { code } = await runSecurity([
        "add-generic-password",
        "-s",
        service,
        "-a",
        account,
        "-D",
        description,
        "-w",
        secret,
        "-T",
        SECURITY,
      ]);
      if (code !== 0) {
        throw new KeychainError(
          `Writing the keychain item "${account}" failed (security exited ${code}).`,
          code,
        );
      }
    },

    remove: async (account) => {
      ensure();
      const { code } = await runSecurity(["delete-generic-password", "-s", service, "-a", account]);
      if (code === ITEM_NOT_FOUND) return false;
      if (code !== 0) {
        throw new KeychainError(
          `Deleting the keychain item "${account}" failed (security exited ${code}).`,
          code,
        );
      }
      return true;
    },
  };
};
