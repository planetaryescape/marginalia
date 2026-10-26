// Hand-built PDFs for tests: synthetic text only.
const esc = (s: string) => s.replace(/[\\()]/g, "\\$&");

/**
 * A small PDF built by hand: one Helvetica page per entry, a line per string,
 * and an outline entry per `outline` item pointing at its page. Synthetic
 * text only.
 */
export function makePdf(
  pages: string[][],
  outline: { title: string; page: number }[] = [],
): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  const catalog = add("");
  const pagesRoot = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  for (const lines of pages) {
    const stream = lines.length
      ? `BT /F1 11 Tf 72 740 Td 14 TL ${lines
          .map((l) => `(${esc(l)}) Tj T*`)
          .join(" ")} ET`
      : "";
    const content = add(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  }
  objects[pagesRoot - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let outlinesRef = "";
  if (outline.length) {
    const root = objects.length + 1;
    const items = outline.map((_, i) => root + 1 + i);
    add(
      `<< /Type /Outlines /First ${items[0]} 0 R /Last ${items.at(-1)} 0 R /Count ${items.length} >>`,
    );
    for (const [i, entry] of outline.entries())
      add(
        `<< /Title (${esc(entry.title)}) /Parent ${root} 0 R /Dest [${pageIds[entry.page - 1]} 0 R /Fit]${i > 0 ? ` /Prev ${items[i - 1]} 0 R` : ""}${i < items.length - 1 ? ` /Next ${items[i + 1]} 0 R` : ""} >>`,
      );
    outlinesRef = ` /Outlines ${root} 0 R`;
  }
  objects[catalog - 1] =
    `<< /Type /Catalog /Pages ${pagesRoot} 0 R${outlinesRef} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}
