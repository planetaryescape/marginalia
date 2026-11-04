import { expect, it } from "vitest";
import { makeEpub } from "./epub";

it("stores the generated EPUB mimetype as the first uncompressed ZIP entry", () => {
  const bytes = makeEpub();
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(header.getUint32(0, true)).toBe(0x04034b50);
  expect(header.getUint16(8, true)).toBe(0);
  const nameBytes = header.getUint16(26, true);
  expect(new TextDecoder().decode(bytes.subarray(30, 30 + nameBytes))).toBe(
    "mimetype",
  );
});
