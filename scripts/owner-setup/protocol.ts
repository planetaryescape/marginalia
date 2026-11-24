import { Schema } from "effect";

const PreparedSetup = Schema.Struct({
  kind: Schema.Union([Schema.Literal("claimed"), Schema.Literal("unclaimed")]),
  url: Schema.String,
});

export function parsePreparedSetup(input: unknown) {
  try {
    const prepared = Schema.decodeUnknownSync(PreparedSetup)(input);
    const url = new URL(prepared.url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/setup" ||
      url.search ||
      url.hash
    )
      return {
        ok: false,
        message: "The backend returned an unsafe setup address.",
      };
    return { ok: true, kind: prepared.kind, url };
  } catch {
    return {
      ok: false,
      message: "The backend returned an invalid setup response.",
    };
  }
}

export function parseDeployment(input: string | undefined) {
  if (!input) return null;
  const deployment = input.replace(/^(dev|prod|local|anonymous):/u, "");
  return /^[a-z][a-z0-9-]+$/u.test(deployment) ? deployment : null;
}
