import { describe, expect, it } from "vitest";
import { apiKeyHint, isSealedApiKey, openApiKey, sealApiKey } from "./api-key-seal";

const SECRET = "test-secret-with-enough-length-0123456789";
const KEY = "hio_live_abcdefghijklmnop1234";

describe("HioBuy API key sealing", () => {
  it("round-trips without storing the key in clear", async () => {
    const sealed = await sealApiKey(SECRET, KEY);
    expect(isSealedApiKey(sealed)).toBe(true);
    expect(sealed).not.toContain("abcdefghijklmnop");
    expect(await openApiKey(SECRET, sealed)).toBe(KEY);
  });

  it("uses a fresh IV each time", async () => {
    expect(await sealApiKey(SECRET, KEY)).not.toBe(await sealApiKey(SECRET, KEY));
  });

  it("accepts a key saved before encryption", async () => {
    expect(isSealedApiKey(KEY)).toBe(false);
    expect(await openApiKey(SECRET, KEY)).toBe(KEY);
    expect(await openApiKey(undefined, KEY)).toBe(KEY);
  });

  it("returns null for a wrong or missing secret", async () => {
    const sealed = await sealApiKey(SECRET, KEY);
    expect(await openApiKey("another-secret-of-similar-length-987654", sealed)).toBeNull();
    expect(await openApiKey(undefined, sealed)).toBeNull();
  });

  it("shows the same hint for sealed and legacy values", async () => {
    expect(apiKeyHint(await sealApiKey(SECRET, KEY))).toBe("••••1234");
    expect(apiKeyHint(KEY)).toBe("••••1234");
    expect(apiKeyHint(null)).toBeNull();
  });
});
