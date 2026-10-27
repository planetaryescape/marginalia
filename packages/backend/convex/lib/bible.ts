/** Canonical Protestant book IDs (also used by API.Bible), with chapter counts. */
export const BIBLE_BOOKS = [
  ["GEN", "Genesis", 50],
  ["EXO", "Exodus", 40],
  ["LEV", "Leviticus", 27],
  ["NUM", "Numbers", 36],
  ["DEU", "Deuteronomy", 34],
  ["JOS", "Joshua", 24],
  ["JDG", "Judges", 21],
  ["RUT", "Ruth", 4],
  ["1SA", "1 Samuel", 31],
  ["2SA", "2 Samuel", 24],
  ["1KI", "1 Kings", 22],
  ["2KI", "2 Kings", 25],
  ["1CH", "1 Chronicles", 29],
  ["2CH", "2 Chronicles", 36],
  ["EZR", "Ezra", 10],
  ["NEH", "Nehemiah", 13],
  ["EST", "Esther", 10],
  ["JOB", "Job", 42],
  ["PSA", "Psalms", 150],
  ["PRO", "Proverbs", 31],
  ["ECC", "Ecclesiastes", 12],
  ["SNG", "Song of Solomon", 8],
  ["ISA", "Isaiah", 66],
  ["JER", "Jeremiah", 52],
  ["LAM", "Lamentations", 5],
  ["EZK", "Ezekiel", 48],
  ["DAN", "Daniel", 12],
  ["HOS", "Hosea", 14],
  ["JOL", "Joel", 3],
  ["AMO", "Amos", 9],
  ["OBA", "Obadiah", 1],
  ["JON", "Jonah", 4],
  ["MIC", "Micah", 7],
  ["NAM", "Nahum", 3],
  ["HAB", "Habakkuk", 3],
  ["ZEP", "Zephaniah", 3],
  ["HAG", "Haggai", 2],
  ["ZEC", "Zechariah", 14],
  ["MAL", "Malachi", 4],
  ["MAT", "Matthew", 28],
  ["MRK", "Mark", 16],
  ["LUK", "Luke", 24],
  ["JHN", "John", 21],
  ["ACT", "Acts", 28],
  ["ROM", "Romans", 16],
  ["1CO", "1 Corinthians", 16],
  ["2CO", "2 Corinthians", 13],
  ["GAL", "Galatians", 6],
  ["EPH", "Ephesians", 6],
  ["PHP", "Philippians", 4],
  ["COL", "Colossians", 4],
  ["1TH", "1 Thessalonians", 5],
  ["2TH", "2 Thessalonians", 3],
  ["1TI", "1 Timothy", 6],
  ["2TI", "2 Timothy", 4],
  ["TIT", "Titus", 3],
  ["PHM", "Philemon", 1],
  ["HEB", "Hebrews", 13],
  ["JAS", "James", 5],
  ["1PE", "1 Peter", 5],
  ["2PE", "2 Peter", 3],
  ["1JN", "1 John", 5],
  ["2JN", "2 John", 1],
  ["3JN", "3 John", 1],
  ["JUD", "Jude", 1],
  ["REV", "Revelation", 22],
] as const;

export type ReadingScope = "articles" | "mixed" | "bible";
export interface BibleReference {
  book: string;
  bookId: string;
  chapter: number;
  endChapter: number;
  verse?: number;
  endVerse?: number;
  reference: string;
  passageId: string;
}

/** Accept bounded, contiguous passages, never arbitrary provider URLs or IDs. */
export function parseBibleReference(input: string): BibleReference | null {
  const match =
    /^(.*?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?|\s*[-–]\s*(\d{1,3}))?$/.exec(
      input.trim(),
    );
  if (!match) return null;
  const name = match[1].toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  const book = BIBLE_BOOKS.find(
    ([id, title]) =>
      id.toLowerCase() === name ||
      title.toLowerCase() === name ||
      (id === "PSA" && name === "psalm") ||
      (id === "SNG" && name === "song of songs"),
  );
  if (!book) return null;
  const chapter = Number(match[2]);
  const endChapter = match[5] ? Number(match[5]) : chapter;
  const verse = match[3] ? Number(match[3]) : undefined;
  const endVerse = match[4] ? Number(match[4]) : verse;
  if (
    chapter < 1 ||
    endChapter < chapter ||
    endChapter > book[2] ||
    endChapter - chapter > 2
  )
    return null;
  if (
    verse !== undefined &&
    (verse < 1 || !endVerse || endVerse < verse || endVerse > 176)
  )
    return null;
  const suffix =
    verse !== undefined
      ? `:${verse}${endVerse !== verse ? `-${endVerse}` : ""}`
      : endChapter !== chapter
        ? `-${endChapter}`
        : "";
  const start = `${book[0]}.${chapter}${verse ? `.${verse}` : ""}`;
  const end = `${book[0]}.${endChapter}${endVerse ? `.${endVerse}` : ""}`;
  return {
    book: book[1],
    bookId: book[0],
    chapter,
    endChapter,
    verse,
    endVerse,
    reference: `${book[1]} ${chapter}${suffix}`,
    passageId: start === end ? start : `${start}-${end}`,
  };
}

export function estimatePassageMinutes(ref: BibleReference) {
  const starter = BIBLE_STARTERS.find((p) => p.reference === ref.reference);
  if (starter) return starter.minutes;
  const verses = ref.verse
    ? (ref.endVerse ?? ref.verse) - ref.verse + 1
    : (ref.endChapter - ref.chapter + 1) * 28;
  return Math.max(1, Math.ceil((verses * 25) / 200));
}

/** Discovery-only tolerance. Source identity/admission still use the strict
 * parser; a typo can never silently change a stored or cited reference. */
export function parseBibleSearchReference(
  input: string,
): BibleReference | null {
  if (input.length > 160) return null;
  const exact = parseBibleReference(input);
  if (exact) return exact;
  const match =
    /^([1-3]?\s*[a-z][a-z .]*?)\s*(\d{1,3}(?::\d{1,3}(?:\s*[-–]\s*\d{1,3})?|\s*[-–]\s*\d{1,3})?)$/i.exec(
      input.trim(),
    );
  if (!match) return null;
  const fold = (text: string) => text.toLowerCase().replace(/[.\s]/g, "");
  const name = fold(match[1]);
  const books = BIBLE_BOOKS.map(([id, title]) => ({
    id,
    title,
    name: fold(title),
  }));
  const known = books.find(
    (book) =>
      book.name === name ||
      book.id.toLowerCase() === name ||
      (book.id === "PSA" && name === "psalm") ||
      (book.id === "SNG" && name === "songofsongs"),
  );
  if (known) return parseBibleReference(`${known.title} ${match[2]}`);
  if (name.length < 5) return null;
  const near = (a: string, b: string) => {
    if (a[0]?.match(/[1-3]/)?.[0] !== b[0]?.match(/[1-3]/)?.[0]) return false;
    // Doubling the wrong consonant can take two edits (collosians, Phillipians).
    // Only discovery tolerates this, and the caller still requires one book match.
    const singleLetters = (value: string) => value.replace(/([a-z])\1+/g, "$1");
    if (singleLetters(a) === singleLetters(b)) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a.length !== b.length) {
      const [short, long] = a.length < b.length ? [a, b] : [b, a];
      for (let i = 0; i < long.length; i++)
        if (long.slice(0, i) + long.slice(i + 1) === short) return true;
      return false;
    }
    const different = Array.from(a, (char, index) =>
      char === b[index] ? -1 : index,
    ).filter((index) => index >= 0);
    return (
      different.length === 1 ||
      (different.length === 2 &&
        different[1] === different[0] + 1 &&
        a[different[0]] === b[different[1]] &&
        a[different[1]] === b[different[0]])
    );
  };
  const candidates = books.filter((book) => near(name, book.name));
  return candidates.length === 1
    ? parseBibleReference(`${candidates[0].title} ${match[2]}`)
    : null;
}

export const BIBLE_STARTERS = [
  {
    reference: "Psalms 23",
    topic: "Rest and trust",
    keywords: "rest trust comfort grief loss fear shepherd",
    minutes: 1,
  },
  {
    reference: "Matthew 6:19-34",
    topic: "Worry and priorities",
    keywords: "anxiety worry money priorities tomorrow provision",
    minutes: 3,
  },
  {
    reference: "Philippians 4",
    topic: "Peace in difficult circumstances",
    keywords: "peace anxiety joy contentment gratitude",
    minutes: 3,
  },
  {
    reference: "1 Corinthians 13",
    topic: "Love in practice",
    keywords: "love relationships marriage patience kindness",
    minutes: 2,
  },
  {
    reference: "James 1",
    topic: "Wisdom through trials",
    keywords: "wisdom trials suffering perseverance listening anger",
    minutes: 4,
  },
  {
    reference: "Luke 15",
    topic: "Being lost and being found",
    keywords: "forgiveness mercy repentance lost grace prodigal",
    minutes: 5,
  },
  {
    reference: "Romans 8",
    topic: "Hope and belonging",
    keywords: "hope suffering spirit assurance belonging salvation",
    minutes: 6,
  },
  {
    reference: "Matthew 5-7",
    topic: "The Sermon on the Mount",
    keywords: "ethics justice prayer discipleship enemies teaching",
    minutes: 15,
  },
  {
    reference: "Genesis 1-3",
    topic: "Beginnings",
    keywords: "creation beginning humanity sin garden origins",
    minutes: 12,
  },
  {
    reference: "John 1-3",
    topic: "An introduction to Jesus",
    keywords: "jesus gospel faith belief life light salvation",
    minutes: 18,
  },
  {
    reference: "Ruth 1-3",
    topic: "Loyalty and belonging",
    keywords: "loyalty family friendship kindness widow migration",
    minutes: 12,
  },
  {
    reference: "Exodus 1-3",
    topic: "Oppression and a calling",
    keywords: "freedom oppression liberation calling moses justice",
    minutes: 14,
  },
  {
    reference: "Psalms 139",
    topic: "Being known",
    keywords: "identity worth known purpose loneliness",
    minutes: 3,
  },
  {
    reference: "Ecclesiastes 3",
    topic: "Seasons of life",
    keywords: "time seasons change death meaning work",
    minutes: 3,
  },
  {
    reference: "Hebrews 11",
    topic: "Living by faith",
    keywords: "faith courage trust endurance",
    minutes: 6,
  },
  {
    reference: "Isaiah 40",
    topic: "Strength for the weary",
    keywords: "strength weary tired hope burnout comfort",
    minutes: 5,
  },
] as const;

export interface BibleSuggestion {
  reference: string;
  title: string;
  minutes: number;
  reason: string;
}

export function starterPassages(
  question: string,
  minutes?: number,
): BibleSuggestion[] {
  const words = question
    .toLowerCase()
    .split(/\W+/)
    .filter(
      (s) =>
        s.length > 2 &&
        ![
          "bible",
          "read",
          "about",
          "have",
          "minutes",
          "want",
          "some",
          "passages",
          "something",
        ].includes(s),
    );
  return BIBLE_STARTERS.map((p) => ({
    ...p,
    score: words.reduce(
      (score, word) =>
        score +
        (p.keywords.includes(word) || p.topic.toLowerCase().includes(word)
          ? 1
          : 0),
      0,
    ),
  }))
    .filter(
      (p) =>
        (!words.length || p.score > 0) &&
        (minutes === undefined || p.minutes <= minutes),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        (minutes === undefined
          ? 0
          : Math.abs(a.minutes - minutes) - Math.abs(b.minutes - minutes)),
    )
    .slice(0, 3)
    .map((p) => ({
      reference: p.reference,
      title: p.topic,
      minutes: p.minutes,
      reason: p.topic,
    }));
}
