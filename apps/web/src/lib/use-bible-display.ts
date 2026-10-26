"use client";
import { parseBibleReference } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useConvexConnectionState, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useState } from "react";
import { bibleDisplayAnchors } from "./bible-display";

type Source = NonNullable<
  NonNullable<FunctionReturnType<typeof api.readerBootstrap.get>>["article"]
>;
type Display = FunctionReturnType<typeof api.actions.bible.readComparison>;

export function useBibleDisplay(source: Source | null | undefined) {
  const [comparing, setComparing] = useState(false);
  const [otherVersion, setOtherVersion] = useState(2692);
  const [display, setDisplay] = useState<Display | null>(null);
  const [leaseToken, setLeaseToken] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [online, setOnline] = useState(true);
  const connection = useConvexConnectionState();
  const connected = online && connection.isWebSocketConnected;
  const primaryId = source?.bible?.displayVersionId;
  const reference = source?.bible?.reference;
  const parsedReference = reference ? parseBibleReference(reference) : null;
  const sourceId = source?._id;
  const idsKey = reference
    ? (primaryId
        ? [primaryId, ...(comparing ? [otherVersion] : [])]
        : comparing
          ? [otherVersion]
          : []
      ).join(",")
    : "";
  const needsDisplay = Boolean(idsKey);
  const read = useAction(api.actions.bible.readComparison);
  const active = useQuery(
    api.bible.activeLicensedReading,
    needsDisplay ? {} : "skip",
  );
  useEffect(() => {
    if (!sourceId) return;
    setComparing(false);
    setOtherVersion(primaryId === 111 ? 2692 : 111);
  }, [sourceId, primaryId]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    let current = true;
    setError("");
    if (!needsDisplay || !reference || !sourceId) return;
    if (!online) {
      setError(
        retry > 0
          ? "Reconnect before retrying Bible text."
          : "Bible text requires a live connection.",
      );
      return;
    }
    const ids = idsKey.split(",").map(Number);
    const token = crypto.randomUUID();
    setLeaseToken(token);
    const timeout = setTimeout(() => {
      current = false;
      setError("The Bible text took too long to load. Please retry.");
    }, 30_000);
    void read({ reference, versionIds: ids, displayToken: token }).then(
      (result) => {
        if (current) setDisplay(result);
        clearTimeout(timeout);
      },
      (failure: unknown) => {
        if (current)
          setError(
            failure instanceof Error
              ? failure.message
              : "Couldn't load Bible text. Please retry.",
          );
        clearTimeout(timeout);
      },
    );
    return () => {
      current = false;
      clearTimeout(timeout);
    };
  }, [read, sourceId, reference, idsKey, needsDisplay, online, retry]);
  const current =
    display &&
    display.reference === reference &&
    (active === display.token || active === leaseToken) &&
    connected;
  const primary =
    primaryId && current
      ? display.panes.find((pane) => pane.id === primaryId)
      : undefined;
  const comparison =
    comparing && current
      ? display.panes.find(
          (pane) => pane.id === otherVersion && pane.id !== primaryId,
        )
      : undefined;
  const content = useMemo(
    () =>
      primary && typeof DOMParser !== "undefined"
        ? (new DOMParser().parseFromString(primary.html, "text/html").body
            .textContent ?? "")
        : undefined,
    [primary],
  );
  const anchors = useMemo(
    () =>
      primary && reference
        ? bibleDisplayAnchors(reference, source?.content ?? "", primary.html)
        : [],
    [primary, reference, source?.content],
  );
  const article =
    source && primaryId
      ? primary
        ? {
            ...source,
            content,
            contentHtml: primary.html,
            author: primary.title,
            url: parsedReference
              ? `https://www.bible.com/bible/${primary.id}/${parsedReference.bookId}.${parsedReference.chapter}`
              : `https://www.bible.com/versions/${primary.id}`,
            bible: source.bible
              ? { ...source.bible, copyright: primary.copyright }
              : undefined,
          }
        : undefined
      : source;
  return {
    article,
    source,
    comparing,
    setComparing,
    otherVersion,
    setOtherVersion,
    primaryId,
    primary,
    comparison,
    anchors,
    fontCss: display?.fontCss,
    error:
      error ||
      (display && display.reference === reference && !current
        ? "This Bible display is no longer active or its connection is unavailable. Read here to resume."
        : ""),
    retry: () => setRetry((n) => n + 1),
  };
}
