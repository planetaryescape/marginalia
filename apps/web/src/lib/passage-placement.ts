export function passagePlacement(
  rect: { top: number; bottom: number; left: number; width: number },
  viewport: { width: number; height: number; top: number },
  menu: { width: number; height: number },
) {
  const gutter = 12;
  const minTop = viewport.top + 68;
  const maxBottom = viewport.top + viewport.height - gutter;
  const above = rect.top - menu.height - 16;
  const below = above < minTop;
  const top = Math.max(
    minTop,
    Math.min(below ? rect.bottom + 16 : above, maxBottom - menu.height),
  );
  const width = Math.min(menu.width, viewport.width - gutter * 2);
  const left = Math.max(
    gutter + width / 2,
    Math.min(rect.left + rect.width / 2, viewport.width - gutter - width / 2),
  );
  return { top, left, below, mobile: true };
}
