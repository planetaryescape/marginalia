// The configured deployment URL has previously carried a trailing newline.
export const CONVEX_SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim() ??
  process.env.NEXT_PUBLIC_CONVEX_URL?.trim().replace(
    /\.convex\.cloud\/?$/,
    ".convex.site",
  );
