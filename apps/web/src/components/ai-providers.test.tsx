import { getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviders } from "./ai-providers";

const fixture = vi.hoisted(() => ({
  results: {} as Record<string, unknown>,
}));
vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    fixture.results[getFunctionName(ref)],
}));
afterEach(() => {
  fixture.results = {};
});

const capabilities = {
  text: true,
  embeddings: true,
  providers: ["openai"],
};

describe("ChatGPT plan in AI providers", () => {
  it("renders nothing about ChatGPT while the server doesn't offer it", () => {
    fixture.results = {
      "providerCredentials:list": [],
      "providerCredentials:capabilities": capabilities,
      "chatgpt:connection": null,
    };
    const html = renderToStaticMarkup(<AiProviders />);
    expect(html).toContain("OpenAI");
    expect(html).not.toContain("ChatGPT");
    const secretInputs = html.match(/<input[^>]*type="password"[^>]*>/g);
    expect(secretInputs).toHaveLength(3);
    for (const input of secretInputs ?? [])
      expect(input).toContain('data-1p-ignore="true"');
  });

  it("offers Continue with ChatGPT when the server enables it", () => {
    fixture.results = {
      "providerCredentials:list": [],
      "providerCredentials:capabilities": {
        ...capabilities,
        chatgptAvailable: true,
      },
      "chatgpt:connection": { connection: null },
    };
    expect(renderToStaticMarkup(<AiProviders />)).toContain(
      "Continue with ChatGPT",
    );
  });

  it("shows the connected account, plan status, usage link and Disconnect", () => {
    fixture.results = {
      "providerCredentials:list": [],
      "providerCredentials:capabilities": {
        ...capabilities,
        chatgptAvailable: true,
      },
      "chatgpt:connection": {
        connection: {
          email: "plan@example.com",
          status: "plan_disabled",
          message: "Plan usage wasn't allowed.",
          models: 0,
          connectedAt: 1,
        },
      },
    };
    const html = renderToStaticMarkup(<AiProviders />);
    expect(html).toContain("plan@example.com");
    expect(html).toContain("Plan usage not enabled");
    expect(html).toContain("Plan usage wasn&#x27;t allowed.");
    expect(html).toContain("Allow plan usage");
    expect(html).toContain("https://chatgpt.com/settings/usage");
    expect(html).toContain("Disconnect");
  });
});

describe("catch-up status", () => {
  it("shows progress only while a catch-up is running", () => {
    fixture.results = {
      "providerCredentials:list": [],
      "providerCredentials:capabilities": capabilities,
      "catchUp:status": null,
    };
    expect(renderToStaticMarkup(<AiProviders />)).not.toContain("Catching up");
    fixture.results["catchUp:status"] = { articlesQueued: 1, itemsQueued: 30 };
    expect(renderToStaticMarkup(<AiProviders />)).toContain(
      "Catching up on what was saved without a key: 30 items indexed for search and 1 article sent for marginalia so far.",
    );
  });
});
