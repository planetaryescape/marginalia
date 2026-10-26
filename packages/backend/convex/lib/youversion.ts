import { z } from "zod";
import type { BibleReference } from "./bible";
import {
  type BibleResourceCache,
  cachedBibleResource,
} from "./bibleResourceCache";

const passageSchema = z.object({
  id: z.string(),
  content: z.string().min(1).max(500_000),
  reference: z.string().min(1).max(200),
});
const catalogueEntry = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(400),
  language_tag: z.string().max(100),
});
const catalogueSchema = z.object({
  data: z.array(catalogueEntry).max(15_000),
  next_page_token: z.string().nullish(),
});
const versionSchema = catalogueEntry.extend({
  abbreviation: z.string().min(1).max(100),
  copyright: z.string().nullish(),
  promotional_content: z.string().nullish(),
  publisher_url: z.string().nullish(),
});

function connection() {
  const key = process.env.YOUVERSION_APP_KEY?.trim();
  if (process.env.YOUVERSION_READING_ENABLED !== "true" || !key)
    throw new Error("The licensed Bible connection is not enabled.");
  return { key, headers: { "X-YVP-App-Key": key } };
}

async function request(
  path: string,
  headers: Record<string, string>,
  cache?: BibleResourceCache,
  validate: (body: string) => void = () => {},
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(headers["X-YVP-App-Key"]),
  );
  const scope = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const body = await cachedBibleResource({
    cache,
    key: `yv:${scope}:${path}`,
    validate,
    load: async () => {
      const response = await fetch(`https://api.youversion.com/v1/${path}`, {
        headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "This Bible edition is not authorized for the app. Choose another translation."
            : response.status === 404
              ? "This edition does not include that passage. Check the reference or choose another version."
              : response.status === 429
                ? "The Bible text service is busy. Wait a minute and try again."
                : "Couldn't load this Bible from YouVersion. Please try again.",
        );
      return response;
    },
  });
  return new Response(body);
}

/** Default collection is entitlement-filtered. Never request all_available=true. */
export async function fetchYouVersionCatalogue(cache?: BibleResourceCache) {
  const { headers } = connection();
  const params = new URLSearchParams({
    "language_ranges[]": "*",
    page_size: "*",
  });
  for (const field of ["id", "title", "language_tag"])
    params.append("fields[]", field);
  const { data, next_page_token } = catalogueSchema.parse(
    await (
      await request(`bibles?${params}`, headers, cache, (body) => {
        const result = catalogueSchema.parse(JSON.parse(body));
        if (result.next_page_token)
          throw new Error(
            "The complete Bible catalogue could not be loaded. Please retry.",
          );
      })
    ).json(),
  );
  if (next_page_token)
    throw new Error(
      "The complete Bible catalogue could not be loaded. Please retry.",
    );
  return data.map(({ id, title, language_tag }) => ({
    id,
    title,
    language: language_tag,
  }));
}

function publisherLink(version: z.infer<typeof versionSchema>) {
  if (
    version.id === 111 ||
    version.id === 113 ||
    /biblica/i.test(version.copyright ?? "")
  )
    return { publisher: "Biblica", publisherUrl: "https://www.biblica.com/" };
  if (
    version.id === 100 ||
    version.id === 2692 ||
    /lockman/i.test(version.copyright ?? "")
  )
    return {
      publisher: "The Lockman Foundation",
      publisherUrl: "https://www.lockman.org/",
    };
  if (version.publisher_url) {
    try {
      const url = new URL(version.publisher_url);
      if (url.protocol === "https:" || url.protocol === "http:")
        return { publisher: "Publisher", publisherUrl: url.href };
    } catch {
      /* Missing or invalid publisher links are not executable URLs. */
    }
  }
  return {
    publisher: "Version and publisher information",
    publisherUrl: `https://www.bible.com/versions/${version.id}`,
  };
}

/** Check configuration and request bounds without downloading display text.
 * Actual entitlements and attribution are checked when the reader fetches it.
 */
export function validateYouVersionReading(
  ref: BibleReference,
  versionIds: number[],
) {
  connection();
  if (
    versionIds.length < 1 ||
    versionIds.length > 2 ||
    new Set(versionIds).size !== versionIds.length ||
    versionIds.some((id) => !Number.isSafeInteger(id) || id < 1)
  )
    throw new Error("Choose one or two different Bible versions.");
  // Two panes, each within a single chapter: never display more than two chapters.
  if (ref.endChapter !== ref.chapter)
    throw new Error(
      "Choose a passage within one chapter. Use chapter navigation to continue.",
    );
  // YouVersion ranges use JHN.3.16-21, not API.Bible's JHN.3.16-JHN.3.21.
  return `${ref.bookId}.${ref.chapter}${ref.verse === undefined ? "" : `.${ref.verse}${ref.endVerse !== ref.verse ? `-${ref.endVerse}` : ""}`}`;
}

/** Licensed display only: shared HTTP cache, never article storage, embeddings or AI. */
export async function fetchYouVersionComparison(
  ref: BibleReference,
  versionIds: number[],
  cache?: BibleResourceCache,
) {
  const passageId = validateYouVersionReading(ref, versionIds);
  const { key, headers } = connection();
  const [panes, fontCss] = await Promise.all([
    Promise.all(
      versionIds.map(async (id) => {
        const [passage, version] = await Promise.all([
          request(
            `bibles/${id}/passages/${encodeURIComponent(passageId)}?format=html&include_headings=true&include_notes=true`,
            headers,
            cache,
            (body) => {
              const passage = passageSchema.parse(JSON.parse(body));
              if (passage.id !== passageId)
                throw new Error(
                  "The Bible service returned a different passage or edition.",
                );
            },
          )
            .then((r) => r.json())
            .then((body) => passageSchema.parse(body)),
          request(`bibles/${id}`, headers, cache, (body) => {
            const version = versionSchema.parse(JSON.parse(body));
            if (
              version.id !== id ||
              !(
                version.copyright?.trim() || version.promotional_content?.trim()
              )
            )
              throw new Error(
                "This edition has no current display attribution or returned a different edition.",
              );
          })
            .then((r) => r.json())
            .then((body) => versionSchema.parse(body)),
        ]);
        if (version.id !== id || passage.id !== passageId)
          throw new Error(
            "The Bible service returned a different passage or edition.",
          );
        let copyright =
          version.copyright?.trim() || version.promotional_content?.trim();
        if (!copyright)
          throw new Error("This edition has no current display attribution.");
        const publisher = publisherLink(version);
        if (
          publisher.publisher === "The Lockman Foundation" &&
          !/used by permission/i.test(copyright)
        )
          copyright +=
            "\nUsed by permission. For permission to quote information, visit www.Lockman.org.";
        return {
          id,
          title: version.title,
          abbreviation: version.abbreviation,
          language: version.language_tag,
          reference: passage.reference,
          html: passage.content,
          copyright,
          ...publisher,
        };
      }),
    ),
    // Header authentication keeps the app key out of browser URLs and resources.
    request("fonts/1/stylesheet", headers, cache, (body) => {
      if (body.includes(key) || body.length > 200_000)
        throw new Error(
          "The Bible font stylesheet could not be delivered safely.",
        );
    }).then((r) => r.text()),
  ]);
  if (fontCss.includes(key) || fontCss.length > 200_000)
    throw new Error("The Bible font stylesheet could not be delivered safely.");
  return { reference: ref.reference, panes, fontCss };
}
