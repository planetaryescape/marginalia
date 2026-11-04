import { expect, it } from "vitest";
import { localUsageSentence, occurrenceAt } from "./localContext";

function referenceOccurrenceAt(
  text: string,
  needle: string,
  occurrence: number,
): number {
  let squashed = "";
  const rawOf: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (!squashed || squashed.endsWith(" ")) continue;
      squashed += " ";
    } else squashed += text[i];
    rawOf.push(i);
  }
  const lowered = squashed.toLowerCase();
  const raw: number[] = [];
  for (let k = 0; k < squashed.length; k++)
    for (let n = squashed[k].toLowerCase().length; n > 0; n--)
      raw.push(rawOf[k]);
  const target = needle.replace(/\s+/g, " ").trim().toLowerCase();
  if (!target) return 0;
  const positions: number[] = [];
  for (
    let at = lowered.indexOf(target);
    at >= 0;
    at = lowered.indexOf(target, at + 1)
  )
    positions.push(raw[at] ?? 0);
  return positions[Math.min(occurrence, positions.length - 1)] ?? 0;
}

const equivalenceCases = [
  "",
  "  \tbank\n\r bank  ",
  "İ BANK İ bank",
  "bankbank",
  "\u00a0bank\u2028\u2029bank\u00a0",
].flatMap((text) =>
  ["bank", "İ", "", " BANK \t"].flatMap((needle) =>
    [0, 1, 2, 99].map((occurrence) => ({ text, needle, occurrence })),
  ),
);

it.each(
  equivalenceCases,
)("preserves legacy raw offsets for $text / $needle occurrence $occurrence", ({
  text,
  needle,
  occurrence,
}) => {
  expect(occurrenceAt(text, needle, occurrence)).toBe(
    referenceOccurrenceAt(text, needle, occurrence),
  );
});

it.each([
  {
    repeated: "The river bank is muddy. ",
    ending: "This bank lends money.",
    endingOffset: 5,
  },
  {
    repeated: "The\t river \n bank is muddy. \t",
    ending: "This \t bank lends money.",
    endingOffset: 7,
  },
])("retains the exact final raw range and sentence after 12,000 occurrences of $repeated", ({
  repeated,
  ending,
  endingOffset,
}) => {
  const text = repeated.repeat(12_000) + ending;
  const at = occurrenceAt(text, "bank", 12_000);
  const expectedStart = repeated.length * 12_000 + endingOffset;
  expect([at, at + 4]).toEqual([expectedStart, expectedStart + 4]);
  expect(text.slice(at, at + 4)).toBe("bank");
  expect(localUsageSentence(text, "bank", 12_000)).toBe(
    "This bank lends money.",
  );
});
