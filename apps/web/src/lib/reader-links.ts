/**
 * A link in the article that leaves it for another web page. In-page jumps
 * (`#…`, and links to a place within this article's address) stay with the
 * reader's jump handling and are not returned here.
 */
export type LeavingLink = {
  /** Absolute address, resolved against the article's own URL rather than the reader's page. */
  href: string;
  /** The link's visible text, trimmed. */
  text: string;
  anchor: HTMLAnchorElement;
};

export function leavingLinkOf(
  anchor: HTMLAnchorElement,
  articleUrl: string,
): LeavingLink | null {
  const raw = anchor.getAttribute("href");
  if (!raw || raw.startsWith("#")) return null;
  let target: URL;
  try {
    target = new URL(raw, articleUrl);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  // A link to a place within this article keeps the reader's jump behaviour
  const samePage = new URL(target.href);
  samePage.hash = "";
  if (target.hash && samePage.href === new URL(articleUrl).href) return null;
  return {
    href: target.href,
    text: anchor.textContent?.trim() ?? "",
    anchor,
  };
}

/**
 * Intercepts plain clicks on leaving links inside `root` with one listener, so
 * the article's HTML can be replaced without rebinding. Modifier clicks and
 * non-primary buttons are left to the browser, as is anything already handled.
 * Returns the cleanup function.
 */
export function attachLeavingLinks(
  root: HTMLElement,
  articleUrl: string,
  onLink: (link: LeavingLink) => void,
): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement) || !root.contains(anchor))
      return;
    const link = leavingLinkOf(anchor, articleUrl);
    if (!link) return;
    event.preventDefault();
    onLink(link);
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
