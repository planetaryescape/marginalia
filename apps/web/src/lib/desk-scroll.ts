/** Memory and paging share the persistent desk viewport, never the window. */
export function deskScroller() {
  return document.querySelector<HTMLElement>(".desk-route");
}
