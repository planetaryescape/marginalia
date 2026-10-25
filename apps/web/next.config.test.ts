import {
  getRedirectUrl,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

async function responseFor(url: string) {
  return unstable_getResponseFromNextConfig({ url, nextConfig });
}

describe("legacy Vercel alias redirect", () => {
  it("redirects page destinations to the canonical host and preserves the path and query", async () => {
    const response = await responseFor(
      "https://marginalia-drab.vercel.app/read/article-1?from=invite",
    );

    expect(response.status).toBe(307);
    expect(getRedirectUrl(response)).toBe(
      "https://reader.bhekani.com/read/article-1?from=invite",
    );
  });

  it("redirects the home page to the canonical root", async () => {
    const response = await responseFor("https://marginalia-drab.vercel.app/");

    expect(response.status).toBe(307);
    expect(getRedirectUrl(response)).toBe("https://reader.bhekani.com/");
  });

  it.each([
    "https://reader.bhekani.com/read/article-1",
    "http://localhost:3107/read/article-1",
    "https://reader.example.org/read/article-1",
    "https://another-project.vercel.app/read/article-1",
    "https://marginalia-drab.vercel.app.attacker.test/read/article-1",
    "https://marginalia-drab.vercel.app/api/auth/passkey",
    "https://marginalia-drab.vercel.app/api",
    "https://marginalia-drab.vercel.app/_next/static/chunk.js",
    "https://marginalia-drab.vercel.app/manifest.webmanifest",
    "https://marginalia-drab.vercel.app/sw.js",
    "https://marginalia-drab.vercel.app/.well-known/webauthn",
  ])("does not redirect %s", async (url) => {
    const response = await responseFor(url);

    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    "invite=private-token",
    "setup=private-token",
  ])("does not put the #%s fragment in the redirect location", async (fragment) => {
    const response = await responseFor(
      `https://marginalia-drab.vercel.app/#${fragment}`,
    );
    const location = getRedirectUrl(response);

    expect(location).toBe("https://reader.bhekani.com/");
    expect(location).not.toContain(fragment);
  });
});
