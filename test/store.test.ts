import { describe, expect, it } from "vitest";

import { UnknownSeedError } from "#/core/errors";
import { buildOtpAuthUri, parseOtpAuthUri } from "#/core/otpauth";
import { createSeedStore, envVarFor } from "#/core/store";
import { memoryKeychain, otpauthUri, RFC_SECRET_BASE32 } from "#test/helpers";

const store = (items: Record<string, string> = {}, env: Record<string, string> = {}) =>
  createSeedStore({ keychain: memoryKeychain(items), env });

describe("seed store", () => {
  it("round-trips a seed through the keychain and indexes it for listing", async () => {
    const s = store();
    await s.put("npm", parseOtpAuthUri(otpauthUri()));

    expect((await s.get("npm")).secret).toBe(RFC_SECRET_BASE32);
    expect((await s.list()).map((x) => x.label)).toEqual(["npm"]);
  });

  it("stores the full otpauth URI, so digits and algorithm survive a restart", async () => {
    const keychain = memoryKeychain();
    const s = createSeedStore({ keychain, env: {} });
    await s.put(
      "npm",
      parseOtpAuthUri(otpauthUri(RFC_SECRET_BASE32, { digits: "8", period: "60" })),
    );

    expect(keychain.items.get("npm")).toMatch(/^otpauth:\/\/totp\//);
    const reloaded = await createSeedStore({ keychain, env: {} }).get("npm");
    expect(reloaded.digits).toBe(8);
    expect(reloaded.period).toBe(60);
  });

  // Docker and CI inject the environment and must beat whatever the machine holds.
  it("prefers an environment seed over the keychain, and reports it only once", async () => {
    const s = store(
      { npm: otpauthUri("MZXW6YTBOI"), __index__: JSON.stringify(["npm"]) },
      { [envVarFor("npm")]: otpauthUri(RFC_SECRET_BASE32) },
    );

    expect((await s.get("npm")).source).toBe("environment");
    expect((await s.get("npm")).secret).toBe(RFC_SECRET_BASE32);
    expect(await s.list()).toHaveLength(1);
  });

  it("accepts a bare base32 secret from the environment", async () => {
    const s = store({}, { [envVarFor("npm")]: RFC_SECRET_BASE32 });
    const seed = await s.get("npm");
    expect(seed.account).toBe("npm");
    expect(seed.digits).toBe(6);
  });

  it("names the registered labels when a seed is missing, so the error is the setup guide", async () => {
    const s = store({ github: otpauthUri(), __index__: JSON.stringify(["github"]) });
    await expect(s.get("npm")).rejects.toThrow(UnknownSeedError);
    await expect(s.get("npm")).rejects.toThrow(/github/);
  });

  it("rejects a label that could collide with the internal index", async () => {
    await expect(store().get("__index__")).rejects.toThrow(/Invalid label/);
  });

  it("rejects labels that would not map back from TOTP_SECRET_<LABEL>", async () => {
    await expect(store().get("npm-prod")).rejects.toThrow(/Invalid label/);
    await expect(store().get("NPM")).rejects.toThrow(/Invalid label/);
  });

  // An indexed-but-missing item has to stay visible: silently omitting it makes a
  // broken seed look like one that was never imported.
  it("surfaces an indexed seed whose keychain item has vanished", async () => {
    const s = store({ __index__: JSON.stringify(["npm"]) });
    const [entry] = await s.list();
    expect(entry?.label).toBe("npm");
    expect(entry?.problem).toMatch(/missing/i);
  });

  it("survives a corrupt index rather than failing every listing", async () => {
    const s = store({ __index__: "{not json", npm: otpauthUri() });
    expect(await s.list()).toEqual([]);
    // The seed is still reachable by label — only enumeration is lost.
    expect((await s.get("npm")).secret).toBe(RFC_SECRET_BASE32);
  });

  it("drops a removed label from the index", async () => {
    const s = store();
    await s.put("npm", parseOtpAuthUri(otpauthUri()));
    expect(await s.remove("npm")).toBe(true);
    expect(await s.list()).toEqual([]);
    expect(await s.remove("npm")).toBe(false);
  });

  it("never puts a secret in a listing", async () => {
    const s = store({}, { [envVarFor("npm")]: RFC_SECRET_BASE32 });
    expect(JSON.stringify(await s.list())).not.toContain(RFC_SECRET_BASE32);
  });

  it("reports no store when the keychain is unavailable and nothing is in the environment", async () => {
    const s = createSeedStore({ keychain: memoryKeychain({}, { available: false }), env: {} });
    expect(s.keychainAvailable()).toBe(false);
    expect(await s.list()).toEqual([]);
    await expect(s.get("npm")).rejects.toThrow(/none are registered/);
  });

  it("keeps buildOtpAuthUri and the store in agreement about the label form", () => {
    expect(buildOtpAuthUri(parseOtpAuthUri(otpauthUri()))).toContain("issuer=npm");
  });
});
