# @mgcrea/mcp-totp

Model Context Protocol server that mints TOTP verification codes on macOS, with the seeds
kept in the login keychain.

It exists so that npm publishing — and anything else gated behind a six-digit code — can run
without a human clicking an approval every five minutes.

## What this is NOT

**It cannot read verification codes out of Passwords.app.** No interface for that exists, and
this is worth stating plainly because it is the first thing everyone assumes:

| Route                                | Why not                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| AppleScript                          | Passwords.app has no scripting dictionary — `sdef` errors `-192`, and there is no `NSAppleScriptEnabled`                                        |
| App Intents / Shortcuts              | No `Metadata.appintents` in the bundle; nothing registers a Passwords action                                                                    |
| `otpauth://` URL scheme              | Registered, but **inbound only** — it imports a seed, it never emits a code                                                                     |
| `/usr/bin/security`                  | No OTP subcommand, and its legacy API cannot see synchronizable iCloud items at all                                                             |
| A helper using `SecItemCopyMatching` | Passwords.app reads TOTP through the `com.apple.password-manager` keychain access group. Apple does not sign that entitlement for third parties |
| Reading `keychain-2.db`              | Readable as a file, encrypted under Secure-Enclave-wrapped class keys                                                                           |
| UI scripting                         | Needs Accessibility and Automation grants _and_ still raises a Touch ID prompt per reveal — so not automation                                   |

So this server keeps **its own copy of the seed** and computes codes locally. What it does
offer is the other direction: `totp_import_uri` can hand the same seed to Passwords.app
through the `otpauth://` scheme it claims, so your phone and Mac keep working normally and
nothing drifts out of sync.

## Security

Read this before deciding to use it.

Storing a TOTP seed on the machine that also holds the credential it protects means
**automation on that machine is effectively single-factor**. Anything that can read the
keychain item can mint codes forever. That is the deliberate trade for unattended publishing,
and it is why every seed-writing tool sits behind `TOTP_ALLOW_WRITES`.

Two narrower properties worth knowing:

- **Seeds are passed to `security` in argv**, because `add-generic-password` has no stdin
  form — its only alternative is an interactive tty prompt. A local process watching `ps`
  could catch one during the milliseconds a write takes.
- **The item's ACL trusts `/usr/bin/security`**, which is what makes reads silent rather than
  prompting. It also means anything on the machine that can run `security` can read the seed.

If you do not need unattended operation, you probably do not need this. For npm specifically,
**trusted publishing over OIDC needs no second factor at all** — configure that first, and
use this only for local publishes and account management.

## Configure

| Variable                | Meaning                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `TOTP_ALLOW_WRITES`     | `1` registers the seed-importing and seed-removing tools. Off by default                                                  |
| `TOTP_SECRET_<LABEL>`   | A seed supplied by environment, for Docker/CI where there is no keychain. Either an `otpauth://` URI or a bare base32 key |
| `TOTP_KEYCHAIN_SERVICE` | Keychain service the seeds are filed under. Defaults to `com.mgcrea.mcp-totp`                                             |
| `TOTP_DEBUG`            | Verbose stderr logging                                                                                                    |

Seeds resolve **environment first, then keychain**, per label — so a `TOTP_SECRET_NPM` in a
container beats whatever the machine holds, without editing anything.

Labels are lower-case letters, digits and underscores, starting alphanumeric (`npm`,
`aws_root`). That restriction is load-bearing: it keeps the mapping to `TOTP_SECRET_<LABEL>`
bijective, so a label you see listed is a label you can look up.

## Quick start

### A. npx

```json
{
  "mcpServers": {
    "totp": {
      "command": "npx",
      "args": ["-y", "@mgcrea/mcp-totp"],
      "env": { "TOTP_ALLOW_WRITES": "1" }
    }
  }
}
```

### B. From source

```bash
pnpm install && pnpm build
TOTP_ALLOW_WRITES=1 node dist/cli.js
```

### Inspect the tools

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ci","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| node dist/cli.js 2>/dev/null | grep -o '"name":"totp_[a-z_]*"' | sort -u
```

## Tools

**W** = requires `TOTP_ALLOW_WRITES=1`. ⚠ = requires `confirm: true`.

| Tool                      |     | Purpose                                                                                            |
| ------------------------- | --- | -------------------------------------------------------------------------------------------------- |
| `totp_auth_status`        |     | What the server can do, which seeds exist, and the setup guide as data                             |
| `totp_list`               |     | Registered seeds and their parameters. Never a secret                                              |
| `totp_get_code`           |     | Mint the current code for a label                                                                  |
| `totp_import_uri`         | W   | Store a seed from an `otpauth://` URI or base32 key; optionally share it with Passwords.app        |
| `totp_scan_export`        | W   | List the OTP-bearing entries of a Passwords.app CSV export. Returns no passwords, notes or secrets |
| `totp_import_from_export` | W   | Import one entry from that export, by index                                                        |
| `totp_remove`             | W ⚠ | Permanently delete a seed                                                                          |

## Getting a seed in

**Primary path — never writes every password to plaintext.** When a service first hands you
the seed, capture it then:

```
npm profile enable-2fa auth-and-writes        # prints an otpauth:// URI
→ totp_import_uri { label: "npm", uri: "otpauth://...", share_with_passwords_app: true }
```

The same seed lands in the keychain _and_ in Passwords.app, so nothing about your normal
flow changes.

**Secondary path — when you do not want to rotate the service's 2FA.** Export from
Passwords.app (File › Export All Passwords…, which needs the UI and a biometric confirmation
and cannot be driven from here), then:

```
→ totp_scan_export { file_path: "/Users/you/Passwords.csv" }   # pick an index
→ totp_import_from_export { file_path: "...", index: 0, label: "npm" }
→ rm /Users/you/Passwords.csv                                   # it is every credential you have
```

## Traps worth knowing

- **Modifying a keychain item prompts on first use; creating and deleting do not.** On a
  machine that has not yet granted `/usr/bin/security` access to an item,
  `add-generic-password -U` raises an authorization dialog — and with no tty the CLI blocks
  on it forever, taking the server with it. Once allowed, `-U` succeeds silently, so this is
  a first-use gate rather than a permanent one; that is exactly why it must not sit on the
  write path, since it fires on a fresh install. Writes here are therefore delete-then-add,
  which stays inside the two operations that never prompt. Every `security` call is also
  bounded by a 15-second timeout, so a dialog can never wedge the server — it becomes an
  error that names the dialog instead.
- **HOTP is rejected, not coerced.** A counter-based seed minted here would desynchronise the
  counter held by the real authenticator.
- **A code returned by `totp_get_code` enters the transcript.** It is a bearer-equivalent
  second factor. Where an integration can read the store directly, prefer that.
- **The keychain item is not a backup.** `totp_remove` is irreversible; unless the same seed
  still exists in Passwords.app or on a phone, the account's second factor is gone.

## Troubleshooting

**A tool is missing.** Call `totp_auth_status` — an absent tool means configuration, not a
bug. The seed tools need a reachable store (macOS keychain, or one `TOTP_SECRET_<LABEL>`);
the write tools additionally need `TOTP_ALLOW_WRITES=1`.

**A call fails with "timed out after 15s".** macOS raised a keychain authorization dialog and
is waiting for an answer. Look for it on screen and allow it. Until it is dismissed, every
subsequent keychain write is queued behind it.

**`Connection closed` with no tools.** Run `node dist/cli.js` by hand with the same
environment — the startup banner and any error go to stderr, which the client swallows.

## Develop

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

The correctness proof is `test/totp.test.ts`: the RFC 6238 Appendix B vectors across SHA-1,
SHA-256 and SHA-512. They are deterministic and need no credentials, and the suite never
touches the real keychain — `test/helpers.ts` injects an in-memory double.

`@mgcrea/mcp-totp/core` is a published entry point exposing the dependency-free half (TOTP,
`otpauth://` parsing, the keychain store) so other servers can mint codes without loading the
MCP SDK. Nothing under `src/core/` may import `@modelcontextprotocol/server` or zod.

## License

MIT
