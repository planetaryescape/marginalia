import { describe, expect, it } from "vitest";
import {
  readerCorsHeaders,
  readerOrigins,
  readerPreflight,
  withReaderCors,
} from "./cors";

const from = (origin?: string) =>
  new Request("https://x.convex.site/api/library/find", {
    method: "POST",
    headers: origin ? { Origin: origin } : {},
  });

describe("reader origins", () => {
  it("defaults to the production reader", () => {
    expect(readerOrigins(undefined)).toEqual(["https://reader.bhekani.com"]);
    expect(readerOrigins("  ")).toEqual(["https://reader.bhekani.com"]);
  });

  it("parses a list, trims trailing slashes and drops wildcards", () => {
    expect(readerOrigins("https://a.com/, https://b.com ,*")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
  it("rejects null, wildcard, credentials, paths and non-HTTP origins", () => {
    expect(
      readerOrigins(
        "null,*,https://a.com/path,https://u:p@a.com,file://host,http://localhost:3000",
      ),
    ).toEqual(["http://localhost:3000"]);
  });
});

describe("reader CORS headers", () => {
  const origins = ["https://reader.bhekani.com"];

  it("echoes an allowed origin and exposes Server-Timing", () => {
    const headers = readerCorsHeaders(
      from("https://reader.bhekani.com"),
      origins,
    );
    expect(headers["Access-Control-Allow-Origin"]).toBe(
      "https://reader.bhekani.com",
    );
    expect(headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    expect(headers["Access-Control-Allow-Headers"]).toBe(
      "authorization, content-type",
    );
    expect(headers["Access-Control-Expose-Headers"]).toBe(
      "Server-Timing, X-Companion-Model, X-Reader-Prework-Rejection",
    );
    expect(headers["Timing-Allow-Origin"]).toBe("https://reader.bhekani.com");
    expect(headers.Vary).toBe("Origin");
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  it("sends no Access-Control headers to a disallowed origin", () => {
    const headers = readerCorsHeaders(from("https://evil.example"), origins);
    expect(Object.keys(headers)).toEqual(["Vary"]);
  });

  it("sends none without an Origin header", () => {
    expect(Object.keys(readerCorsHeaders(from(), origins))).toEqual(["Vary"]);
  });

  it("replaces CORS headers already on a response", () => {
    const response = withReaderCors(
      from("https://evil.example"),
      new Response("no", {
        status: 401,
        headers: {
          "Access-Control-Allow-Origin": "https://reader.bhekani.com",
          "Server-Timing": "auth;dur=1",
          "Timing-Allow-Origin": "*",
          "X-Companion-Model": "private-model",
        },
      }),
      origins,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(response.headers.get("Timing-Allow-Origin")).toBeNull();
    expect(response.headers.get("Server-Timing")).toBeNull();
    expect(response.headers.get("X-Companion-Model")).toBeNull();
  });

  it("answers a preflight with 204", () => {
    const response = readerPreflight(from("https://reader.bhekani.com"));
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://reader.bhekani.com",
    );
  });
});
