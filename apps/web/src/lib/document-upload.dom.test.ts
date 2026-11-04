// @vitest-environment happy-dom
import { convexTest } from "convex-test";
import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import schema from "../../../../packages/backend/convex/schema";
import { type UploadState, uploadDocument } from "./document-upload";

it("keeps real EPUB metadata through hashing and upload progress", async () => {
  const t = convexTest(schema, {
    "./_generated/api.js": () =>
      import("@marginalia/backend/convex/_generated/api"),
  });
  const ids = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["fixture"]));
    const importId = await ctx.db.insert("documentImports", {
      storageId,
      userId: "reader",
      fileName: "fixture.epub",
      status: "reading",
      step: "text",
      createdAt: 0,
      updatedAt: 0,
    });
    return { storageId, importId };
  });
  const bytes = zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "book.opf": strToU8(
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Real Book Title</dc:title><dc:creator>The Author</dc:creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    ),
    "chapter.xhtml": strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Generated public fixture.</p></body></html>',
    ),
  });
  const states: UploadState[] = [];
  const result = await uploadDocument(
    new File([Uint8Array.from(bytes)], "_Noisy -- archive -- filename.epub"),
    {
      generateUploadUrl: async () => "https://upload.test/fixture",
      upload: async (_url, _file, onProgress) => {
        onProgress(47);
        return ids.storageId;
      },
      startImport: async () => ({ ok: true, importId: ids.importId }),
    },
    (state) => states.push(state),
  );
  expect(result.ok).toBe(true);
  expect(states[0]?.stage).toBe("metadata");
  expect(states.find((state) => state.stage === "checking")).toMatchObject({
    title: "The Real Book Title",
    author: "The Author",
  });
  expect(states.at(-1)).toMatchObject({
    title: "The Real Book Title",
    author: "The Author",
    percent: 47,
    stage: "uploading",
  });
});
