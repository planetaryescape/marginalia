export interface Chunk {
  content: string;
  chunkIndex: number;
  heading?: string;
}

// A byte bound is conservative for multilingual text as well as ASCII.
export const MAX_CHUNK_BYTES = 3200;

/**
 * Split a note into chunks:
 * 1. Primary split on ## headings
 * 2. Prefer paragraph/sentence/word boundaries, then split long Unicode tokens
 * 3. Include "fileName > heading:" within the MAX_CHUNK_BYTES budget
 */
export function chunkNote(fileName: string, content: string): Chunk[] {
  if (!content.trim()) return [];

  // Split on H2 headings
  const sections = splitOnHeadings(content);
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const heading = section.heading || "Introduction";
    const prefix = `${fileName} > ${heading}:\n`;
    let text = section.text.trim() || section.heading || "";
    const budget = MAX_CHUNK_BYTES - Buffer.byteLength(prefix, "utf8");
    if (budget < 4)
      throw new Error("File name/heading exceeds chunk context budget");
    while (text) {
      let end = 0;
      let bytes = 0;
      for (const character of text) {
        const size = Buffer.byteLength(character, "utf8");
        if (bytes + size > budget) break;
        bytes += size;
        end += character.length;
      }
      if (end < text.length) {
        const candidate = text.slice(0, end);
        // Prefer paragraphs, sentences, then words; hard split a long token.
        const paragraph = candidate.lastIndexOf("\n\n");
        const sentence = [...candidate.matchAll(/[.!?。！？]\s*/gu)].at(-1);
        const word = [...candidate.matchAll(/\s+/gu)].at(-1);
        const boundary =
          paragraph > 0
            ? paragraph + 2
            : sentence
              ? sentence.index + sentence[0].length
              : word
                ? word.index + word[0].length
                : end;
        if (boundary > 0) end = boundary;
      }
      chunks.push({
        content: prefix + text.slice(0, end),
        chunkIndex: chunkIndex++,
        heading,
      });
      text = text.slice(end);
    }
  }

  return chunks;
}

interface Section {
  heading?: string;
  text: string;
}

function splitOnHeadings(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentHeading: string | undefined;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      // Flush previous section
      if (currentLines.length > 0 || currentHeading !== undefined) {
        sections.push({
          heading: currentHeading,
          text: currentLines.join("\n"),
        });
      }
      currentHeading = headingMatch[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Flush last section
  if (currentLines.length > 0 || currentHeading !== undefined) {
    sections.push({
      heading: currentHeading,
      text: currentLines.join("\n"),
    });
  }

  return sections;
}
