import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ENCRYPTION_KEY } from "../../test/owner";
import {
  cleanProviderKey,
  decryptProviderKey,
  encryptProviderKey,
  KEY_NOT_CONFIGURED,
} from "./providerKeys";

const KEY = "sk-test-plaintext-provider-key-1234";

beforeEach(() => {
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provider key encryption", () => {
  it("round-trips a key without storing it in plain text", async () => {
    const sealed = await encryptProviderKey(KEY, "reader-a", "openai");
    expect(JSON.stringify(sealed)).not.toContain(KEY);
    expect(atob(sealed.iv)).toHaveLength(12);
    expect(
      await decryptProviderKey({
        ...sealed,
        userId: "reader-a",
        provider: "openai",
      }),
    ).toBe(KEY);
  });

  it("uses a fresh IV each time", async () => {
    const first = await encryptProviderKey(KEY, "reader-a", "openai");
    const second = await encryptProviderKey(KEY, "reader-a", "openai");
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("refuses to open a key moved to another reader or provider", async () => {
    const sealed = await encryptProviderKey(KEY, "reader-a", "openai");
    await expect(
      decryptProviderKey({ ...sealed, userId: "reader-b", provider: "openai" }),
    ).rejects.toThrow();
    await expect(
      decryptProviderKey({
        ...sealed,
        userId: "reader-a",
        provider: "openrouter",
      }),
    ).rejects.toThrow();
  });

  it("refuses to seal anything without a valid server key", async () => {
    vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", "");
    await expect(encryptProviderKey(KEY, "reader-a", "openai")).rejects.toThrow(
      KEY_NOT_CONFIGURED,
    );
    vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", btoa("too short"));
    await expect(encryptProviderKey(KEY, "reader-a", "openai")).rejects.toThrow(
      KEY_NOT_CONFIGURED,
    );
  });

  it("trims keys and rejects implausible ones without repeating them", () => {
    expect(cleanProviderKey(`  ${KEY}\n`)).toBe(KEY);
    for (const bad of ["short", `${KEY} ${KEY}`, "x".repeat(600)]) {
      expect(() => cleanProviderKey(bad)).toThrow(/complete API key/);
      try {
        cleanProviderKey(bad);
      } catch (error) {
        expect(String(error)).not.toContain(bad);
      }
    }
  });
});
