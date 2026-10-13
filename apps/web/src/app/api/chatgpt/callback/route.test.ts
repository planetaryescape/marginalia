import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getToken: vi.fn(),
  fetchAuthAction: vi.fn(),
}));
vi.mock("@/lib/auth-server", () => auth);

import { GET } from "./route";

const CALLBACK = "https://reader.example.com/api/chatgpt/callback";

afterEach(() => vi.resetAllMocks());

describe("ChatGPT sign-in callback", () => {
  it("forwards code and state with the reader's session and redirects without the code", async () => {
    auth.getToken.mockResolvedValue("session-jwt");
    auth.fetchAuthAction.mockResolvedValue({ status: "connected" });
    const response = await GET(
      new Request(`${CALLBACK}?code=the-code&state=the-state`),
    );
    expect(auth.fetchAuthAction).toHaveBeenCalledWith(expect.anything(), {
      state: "the-state",
      code: "the-code",
      error: undefined,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "https://reader.example.com/account?chatgpt=connected",
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("does nothing while the server doesn't offer ChatGPT", async () => {
    auth.getToken.mockResolvedValue("session-jwt");
    auth.fetchAuthAction.mockResolvedValue({ status: "unavailable" });
    const response = await GET(
      new Request(`${CALLBACK}?code=the-code&state=the-state`),
    );
    expect(response.status).toBe(404);
  });

  it("won't complete a sign-in without a signed-in reader", async () => {
    auth.getToken.mockResolvedValue(undefined);
    const response = await GET(
      new Request(`${CALLBACK}?code=the-code&state=the-state`),
    );
    expect(auth.fetchAuthAction).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toBe(
      "https://reader.example.com/account?chatgpt=failed",
    );
  });

  it("passes a cancelled sign-in through and ignores requests without state", async () => {
    auth.getToken.mockResolvedValue("session-jwt");
    auth.fetchAuthAction.mockResolvedValue({ status: "denied" });
    const denied = await GET(
      new Request(`${CALLBACK}?error=access_denied&state=the-state`),
    );
    expect(auth.fetchAuthAction).toHaveBeenCalledWith(expect.anything(), {
      state: "the-state",
      code: undefined,
      error: "access_denied",
    });
    expect(denied.headers.get("Location")).toContain("chatgpt=denied");
    expect((await GET(new Request(`${CALLBACK}?code=x`))).status).toBe(404);
  });
});
