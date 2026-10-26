// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage, { metadata as privacyMetadata } from "@/app/privacy/page";
import TermsPage, { metadata as termsMetadata } from "@/app/terms/page";

describe("public legal notices", () => {
  it.each([
    [PrivacyPage, privacyMetadata, "Privacy Policy"],
    [TermsPage, termsMetadata, "Terms of Service"],
  ] as const)("renders a readable notice with navigation", (Page, metadata, title) => {
    const html = renderToStaticMarkup(<Page />);
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector("main h1")?.textContent).toBe(title);
    expect(metadata.title).toBe(`${title} · Marginalia`);
    expect(document.querySelector('header a[href="/"]')?.textContent).toBe(
      "Marginalia",
    );
    expect(document.querySelector("main article")?.textContent).toContain(
      "Bhekani Khumalo",
    );
    expect(
      document.querySelector('footer a[href="/privacy"]')?.textContent,
    ).toBe("Privacy Policy");
    expect(document.querySelector('footer a[href="/terms"]')?.textContent).toBe(
      "Terms of Service",
    );
  });
});
