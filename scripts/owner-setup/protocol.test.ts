import { expect, it } from "bun:test";
import { parseDeployment, parsePreparedSetup } from "./protocol";

it("parses deployment names without treating flags as backend targets", () => {
  expect(parseDeployment("dev:diligent-owl-394")).toBe("diligent-owl-394");
  expect(parseDeployment("diligent-owl-394")).toBe("diligent-owl-394");
  expect(parseDeployment("anonymous:anonymous-agent")).toBe("anonymous-agent");
  expect(parseDeployment(undefined)).toBeNull();
  expect(parseDeployment("--prod")).toBeNull();
});

it("accepts only safe canonical setup responses", () => {
  expect(
    parsePreparedSetup({
      kind: "claimed",
      url: "https://reader.example.com/setup",
    }),
  ).toMatchObject({ ok: true, kind: "claimed" });
  expect(
    parsePreparedSetup({
      kind: "unclaimed",
      url: "http://localhost:3107/setup",
    }),
  ).toMatchObject({ ok: true, kind: "unclaimed" });
  for (const url of [
    "http://reader.example.com/setup",
    "https://owner:password@reader.example.com/setup",
    "https://reader.example.com/setup#secret",
    "https://reader.example.com/setup?secret=token",
    "javascript:alert(1)",
  ])
    expect(parsePreparedSetup({ kind: "unclaimed", url })).toMatchObject({
      ok: false,
    });
  expect(
    parsePreparedSetup({
      kind: "unknown",
      url: "https://reader.example.com/setup",
    }),
  ).toMatchObject({ ok: false });
});
