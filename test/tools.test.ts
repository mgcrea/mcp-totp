import { describe, expect, it } from "vitest";

import { envVarFor } from "#/core/store";
import { connect, memoryKeychain, otpauthUri, RFC_SECRET_BASE32 } from "#test/helpers";

const NO_STORE = { keychain: memoryKeychain({}, { available: false }) };

/**
 * The registration matrix, asserted with toEqual so adding a tool is always a
 * deliberate act with a visible diff.
 */
describe("tool registration matrix", () => {
  // The regression that produces "MCP error -32000: Connection closed": a server
  // that exits on startup takes the credential-free tools with it and leaves no
  // way to discover what to configure.
  it("with no store at all, still connects and serves the status tool", async () => {
    expect(await (await connect({}, NO_STORE)).toolNames()).toEqual(["totp_auth_status"]);
  });

  it("with a store but writes off, registers the read tools only", async () => {
    expect(await (await connect({})).toolNames()).toEqual([
      "totp_auth_status",
      "totp_get_code",
      "totp_list",
    ]);
  });

  it("with writes on, adds exactly the four mutating tools", async () => {
    expect(await (await connect({ TOTP_ALLOW_WRITES: "1" })).toolNames()).toEqual([
      "totp_auth_status",
      "totp_get_code",
      "totp_import_from_export",
      "totp_import_uri",
      "totp_list",
      "totp_remove",
      "totp_scan_export",
    ]);
  });

  // An env seed is the whole store on Linux and in Docker, where there is no keychain.
  it("registers the read tools from an environment seed with no keychain", async () => {
    const harness = await connect({ [envVarFor("npm")]: RFC_SECRET_BASE32 }, NO_STORE);
    expect(await harness.toolNames()).toContain("totp_get_code");
  });
});

describe("totp_auth_status", () => {
  it("explains itself when there is no store, instead of erroring", async () => {
    const res = await (await connect({}, NO_STORE)).call("totp_auth_status");
    expect(res.isToolError).toBeFalsy();
    expect(res.keychain_available).toBe(false);
    expect(res.seed_count).toBe(0);
    expect((res.setup as string[]).join(" ")).toContain("TOTP_SECRET_");
  });

  it("reports the write gate and the registered seeds", async () => {
    const harness = await connect(
      { TOTP_ALLOW_WRITES: "1" },
      { keychain: memoryKeychain({ npm: otpauthUri(), __index__: JSON.stringify(["npm"]) }) },
    );
    const res = await harness.call("totp_auth_status");
    expect(res.writes).toBe("ENABLED");
    expect(res.seed_count).toBe(1);
    expect(JSON.stringify(res)).not.toContain(RFC_SECRET_BASE32);
  });
});

const at = (seconds: number) => ({
  keychain: memoryKeychain({ npm: otpauthUri(), __index__: JSON.stringify(["npm"]) }),
  nowMs: seconds * 1000,
});

describe("totp_get_code", () => {
  it("mints the RFC 6238 code for the stored seed", async () => {
    const res = await (await connect({}, at(59))).call("totp_get_code", { label: "npm" });
    expect(res.code).toBe("287082");
    expect(res.seconds_remaining).toBe(1);
    expect(res.source).toBe("keychain");
  });

  it("names the registered labels when asked for one that is not there", async () => {
    const res = await (await connect({}, at(59))).call("totp_get_code", { label: "github" });
    expect(res.isToolError).toBe(true);
    expect(String(res.error)).toContain("npm");
    expect(res.remedy).toContain("totp_list");
  });

  it("rejects a malformed label at the schema boundary", async () => {
    const res = await (await connect({}, at(59))).call("totp_get_code", { label: "" });
    expect(res.isToolError).toBe(true);
  });
});

describe("totp_import_uri", () => {
  it("stores a seed and can hand the same one to Passwords.app", async () => {
    const harness = await connect({ TOTP_ALLOW_WRITES: "1" });
    const res = await harness.call("totp_import_uri", {
      label: "npm",
      uri: otpauthUri(),
      share_with_passwords_app: true,
    });

    expect(res.imported).toBe("npm");
    expect(harness.opened).toHaveLength(1);
    expect(harness.opened[0]).toMatch(/^otpauth:\/\/totp\//);
    expect((await harness.call("totp_list")).seeds).toHaveLength(1);
  });

  it("does not touch Passwords.app unless asked", async () => {
    const harness = await connect({ TOTP_ALLOW_WRITES: "1" });
    await harness.call("totp_import_uri", { label: "npm", uri: otpauthUri() });
    expect(harness.opened).toEqual([]);
  });

  it("never echoes the secret back", async () => {
    const harness = await connect({ TOTP_ALLOW_WRITES: "1" });
    const res = await harness.call("totp_import_uri", { label: "npm", uri: otpauthUri() });
    expect(JSON.stringify(res)).not.toContain(RFC_SECRET_BASE32);
  });

  it("rejects an HOTP seed rather than desynchronising the real authenticator", async () => {
    const harness = await connect({ TOTP_ALLOW_WRITES: "1" });
    const res = await harness.call("totp_import_uri", {
      label: "npm",
      uri: "otpauth://hotp/npm:alice?secret=MZXW6YTBOI&counter=1",
    });
    expect(res.isToolError).toBe(true);
    expect(String(res.error)).toMatch(/HOTP/);
  });
});

describe("totp_remove", () => {
  it("requires an explicit confirm, so a seed is never deleted in passing", async () => {
    const harness = await connect({ TOTP_ALLOW_WRITES: "1" });
    await harness.call("totp_import_uri", { label: "npm", uri: otpauthUri() });

    const withoutConfirm = await harness.call("totp_remove", { label: "npm" });
    expect(withoutConfirm.isToolError).toBe(true);
    expect((await harness.call("totp_list")).seeds).toHaveLength(1);

    const withConfirm = await harness.call("totp_remove", { label: "npm", confirm: true });
    expect(withConfirm.removed).toBe(true);
    expect((await harness.call("totp_list")).seeds).toEqual([]);
  });
});

/**
 * The contract every tool owes the model, enforced mechanically.
 *
 * These are cheap and they fail the moment a new tool forgets one, which is the
 * only time anyone would notice: a missing `.describe()` is invisible in review
 * and invisible at runtime, and simply makes the model guess.
 */
const all = async () =>
  (await (await connect({ TOTP_ALLOW_WRITES: "1" })).client.listTools()).tools;

describe("tool contract", () => {
  it("gives every tool a service-prefixed title", async () => {
    // `title` is what a host renders in its permission dialog, so a bare
    // "Get Verification Code" re-creates the cross-server collision the name
    // prefix exists to prevent.
    const tools = await all();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.title, tool.name).toMatch(/^TOTP: /);
      expect(tool.name, tool.name).toMatch(/^totp_/);
    }
  });

  it("describes every input field, since that is all a model reads before choosing", async () => {
    for (const tool of await all()) {
      const props = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [field, schema] of Object.entries(props)) {
        expect(schema.description, `${tool.name}.${field}`).toBeTruthy();
      }
    }
  });

  it("annotates every tool", async () => {
    for (const tool of await all()) {
      expect(tool.annotations, tool.name).toBeDefined();
    }
  });

  it("marks the only irreversible tool destructive, and nothing else", async () => {
    const destructive = (await all())
      .filter((t) => t.annotations?.destructiveHint === true)
      .map((t) => t.name);
    expect(destructive).toEqual(["totp_remove"]);
  });
});
