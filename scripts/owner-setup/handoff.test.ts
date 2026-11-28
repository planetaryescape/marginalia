import { expect, it } from "bun:test";
import { createOwnerHandoff } from "./handoff";

it("hands off a setup fragment once without placing the token in the launcher URL", async () => {
  const destination = new URL(
    "https://reader.example.com/setup#setup=fixture-token",
  );
  const handoff = createOwnerHandoff(destination);
  try {
    expect(handoff.url.hostname).toBe("127.0.0.1");
    expect(handoff.url.href).not.toContain("fixture-token");
    const response = await fetch(handoff.url, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(destination.href);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await handoff.opened).toBe(true);
    expect((await fetch(handoff.url, { redirect: "manual" })).status).toBe(410);
  } finally {
    await handoff.close();
  }
});

it("refuses wrong paths and host headers without consuming the handoff", async () => {
  const handoff = createOwnerHandoff(
    new URL("https://reader.example.com/setup"),
  );
  try {
    expect((await fetch(new URL("/wrong", handoff.url))).status).toBe(404);
    expect(
      (await fetch(handoff.url, { headers: { Host: "attacker.example" } }))
        .status,
    ).toBe(404);
    expect((await fetch(handoff.url, { method: "POST" })).status).toBe(404);
    expect((await fetch(handoff.url, { redirect: "manual" })).status).toBe(302);
  } finally {
    await handoff.close();
  }
});

it("times out an unopened handoff", async () => {
  const handoff = createOwnerHandoff(
    new URL("https://reader.example.com/setup"),
    5,
  );
  try {
    expect(await handoff.opened).toBe(false);
  } finally {
    await handoff.close();
  }
});
