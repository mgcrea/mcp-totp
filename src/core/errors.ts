/** A seed was asked for by a label that is not registered. */
export class UnknownSeedError extends Error {
  override readonly name = "UnknownSeedError";
  readonly label: string;

  constructor(label: string, known: string[]) {
    super(
      known.length > 0
        ? `No TOTP seed labelled "${label}". Registered labels: ${known.join(", ")}.`
        : `No TOTP seed labelled "${label}", and none are registered. ` +
            `Import one with totp_import_uri (requires TOTP_ALLOW_WRITES=1).`,
    );
    this.label = label;
  }
}

/** An otpauth:// URI or a bare base32 secret could not be understood. */
export class InvalidSeedError extends Error {
  override readonly name = "InvalidSeedError";
}

/** The `security` CLI failed, or this is not macOS. */
export class KeychainError extends Error {
  override readonly name = "KeychainError";
  readonly exitCode: number | undefined;

  constructor(message: string, exitCode?: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** Thrown when a write path is reached while TOTP_ALLOW_WRITES is off. */
export class WritesDisabledError extends Error {
  override readonly name = "WritesDisabledError";

  constructor(what: string) {
    super(
      `${what} is a write operation, but writes are disabled. ` +
        `Set TOTP_ALLOW_WRITES=1 to enable mutating tools.`,
    );
  }
}
