import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { InvalidSeedError } from "#/core/errors";

const execFileAsync = promisify(execFile);

const OPEN = "/usr/bin/open";

export type UriOpener = (uri: string) => Promise<void>;

/**
 * Hand an `otpauth://` URI to Passwords.app, which registers that scheme with
 * `LSIsAppleDefaultForScheme` — so the seed lands in the user's normal password
 * manager and their phone keeps working, even though nothing can ever read a
 * code back out of it.
 *
 * The scheme check is not a formality. Anything reaching `open` is an app-launch
 * primitive, so a URI that arrived from outside must be proven to be otpauth
 * before it gets there.
 */
export const createUriOpener = (): UriOpener => async (uri) => {
  if (!/^otpauth:\/\//i.test(uri)) {
    throw new InvalidSeedError(`Refusing to open a non-otpauth URI: "${uri.slice(0, 40)}".`);
  }
  await execFileAsync(OPEN, [uri]);
};
