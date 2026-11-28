import { fileURLToPath } from "node:url";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { Stage } from "alchemy/Stage";
import { localState } from "alchemy/State";
import { Config, Effect, Schema } from "effect";

export default Alchemy.Stack(
  "MarginaliaReader",
  { providers: Cloudflare.providers(), state: localState() },
  Effect.gen(function* () {
    const stage = yield* Stage;
    const convexUrl = yield* Config.schema(
      Schema.String.check(
        Schema.isPattern(/^https:\/\/[a-z0-9-]+\.convex\.cloud$/u),
      ),
      "NEXT_PUBLIC_CONVEX_URL",
    );
    const convexSiteUrl = yield* Config.schema(
      Schema.String.check(
        Schema.isPattern(/^https:\/\/[a-z0-9-]+\.convex\.site$/u),
      ),
      "NEXT_PUBLIC_CONVEX_SITE_URL",
    );
    const hostname = Schema.String.check(
      Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/u),
    );
    const domain =
      stage === "prod"
        ? {
            name: yield* Config.schema(hostname, "READER_DOMAIN"),
            zoneName: yield* Config.schema(hostname, "READER_ZONE_NAME"),
          }
        : undefined;
    const website = yield* Cloudflare.Website.Vinext("ReaderWebsite", {
      rootDir: fileURLToPath(new URL("./apps/web", import.meta.url)),
      env: {
        NEXT_PUBLIC_CONVEX_URL: convexUrl,
        NEXT_PUBLIC_CONVEX_SITE_URL: convexSiteUrl,
      },
      compatibility: { date: "2026-11-02", flags: ["nodejs_compat"] },
      workersDev: { enabled: false, previewsEnabled: false },
      ...(domain ? { domain } : {}),
    });
    return { url: website.url };
  }),
);
