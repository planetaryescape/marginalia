"use client";
import { type RefObject, useEffect } from "react";

/** Native modal semantics, with a predictable Tab loop and return focus. */
export function useModalDialog(
  ref: RefObject<HTMLDialogElement | null>,
  open: boolean,
  returnFocus?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previous = document.activeElement;
    dialog.showModal();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button, input, textarea, select, a[href], [tabindex], [contenteditable='true']",
        ),
      ).filter(
        (el) =>
          el.tabIndex >= 0 &&
          !el.matches(":disabled") &&
          el.getClientRects().length > 0,
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      dialog.close();
      const target =
        previous instanceof HTMLElement && previous !== document.body
          ? previous
          : returnFocus?.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [ref, open, returnFocus]);
}
