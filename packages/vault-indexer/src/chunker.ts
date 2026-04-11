export interface Chunk {
  content: string;
  chunkIndex: number;
  heading?: string;
}

// Rough token estimate: 1 token ~ 4 chars
const MAX_CHUNK_CHARS = 3200; // ~800 tokens
const MIN_CHUNK_CHARS = 200; // ~50 tokens

/**
 * Split a note into chunks:
 * 1. Primary split on ## headings
 * 2. If a section exceeds MAX_CHUNK_CHARS, split on paragraph boundaries
 * 3. Prefix each chunk with "fileName > heading:" for retrieval context
 */
export function chunkNote(
  fileName: string,
  content: string,
): Chunk[] {
  if (!content.trim()) return [];

  // Split on H2 headings
  const sections = splitOnHeadings(content);
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const heading = section.heading || "Introduction";
    const prefix = `${fileName} > ${heading}:\n`;
    const text = section.text.trim();

    if (!text || text.length < MIN_CHUNK_CHARS) {
      // Too small — skip unless it's the only section
      if (sections.length === 1 && text) {
        chunks.push({
          content: prefix + text,
          chunkIndex: chunkIndex++,
          heading,
        });
      }
      continue;
    }

    if (text.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        content: prefix + text,
        chunkIndex: chunkIndex++,
        heading,
      });
    } else {
      // Split long sections on paragraph boundaries
      const paragraphs = text.split(/\n\n+/);
      let buffer = prefix;

      for (const para of paragraphs) {
        if (buffer.length + para.length > MAX_CHUNK_CHARS && buffer.length > prefix.length) {
          chunks.push({
            content: buffer.trim(),
            chunkIndex: chunkIndex++,
            heading,
          });
          buffer = prefix;
        }
        buffer += para + "\n\n";
      }

      // Flush remaining
      if (buffer.trim().length > prefix.length) {
        chunks.push({
          content: buffer.trim(),
          chunkIndex: chunkIndex++,
          heading,
        });
      }
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
      if (currentLines.length > 0) {
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
  if (currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      text: currentLines.join("\n"),
    });
  }

  return sections;
}
