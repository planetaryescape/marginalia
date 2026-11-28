export function createOwnerHandoff(destination: URL, timeoutMs = 120_000) {
  const path = `/setup/${crypto.randomUUID()}`;
  const opened = Promise.withResolvers<boolean>();
  let consumed = false;
  const timer = setTimeout(() => opened.resolve(false), timeoutMs);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url);
      if (
        request.method !== "GET" ||
        url.pathname !== path ||
        request.headers.get("host") !== `127.0.0.1:${server.port}`
      )
        return new Response("Not found", { status: 404 });
      if (consumed)
        return new Response("This handoff has already been opened.", {
          status: 410,
          headers: { "Cache-Control": "no-store" },
        });
      consumed = true;
      clearTimeout(timer);
      opened.resolve(true);
      return new Response(null, {
        status: 302,
        headers: {
          Location: destination.href,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": "default-src 'none'",
        },
      });
    },
  });
  return {
    url: new URL(path, server.url),
    opened: opened.promise,
    async close() {
      clearTimeout(timer);
      await server.stop();
    },
  };
}
