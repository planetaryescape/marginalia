export function licensedBibleHref(reference: string, translation: string) {
  const left =
    translation === "niv" ? 111 : translation === "nasb" ? 2692 : null;
  if (left === null) return null;
  return `/bible?${new URLSearchParams({ reference, left: String(left), right: String(left === 111 ? 2692 : 111) })}`;
}
