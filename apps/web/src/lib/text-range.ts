// Re-anchors saved passages by their text, so nothing has to be written into
// the article HTML. Whitespace is compared loosely because selections are
// stored with collapsed whitespace.

function textNodesIn(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      // Annotation footnote numbers are not part of the prose
      node.parentElement?.closest(".annotation-mark sup")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function findIn(root: Node, target: string): Range | null {
  const nodes = textNodesIn(root);
  let flat = "";
  const map: { node: Text; offset: number }[] = [];
  let lastWasSpace = true;
  for (const node of nodes) {
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      const isSpace = /\s/.test(data[i]);
      if (isSpace && lastWasSpace) continue;
      flat += isSpace ? " " : data[i];
      map.push({ node, offset: i });
      lastWasSpace = isSpace;
    }
  }
  const index = flat.indexOf(target);
  if (index === -1) return null;
  const start = map[index];
  const end = map[index + target.length - 1];
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/** Finds `text` in the preferred paragraph first, then anywhere in `root`. */
export function findTextRange(
  root: HTMLElement,
  text: string,
  preferred?: HTMLElement | null,
): Range | null {
  const target = normalizeText(text);
  if (!target) return null;
  return (preferred && findIn(preferred, target)) || findIn(root, target);
}

export function rangeContainsPoint(
  range: Range,
  x: number,
  y: number,
): boolean {
  for (const rect of range.getClientRects()) {
    if (
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    ) {
      return true;
    }
  }
  return false;
}
