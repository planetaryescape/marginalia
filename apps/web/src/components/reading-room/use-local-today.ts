import { useEffect, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");
const dateOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The reader's local date, kept current while the room stays open: it changes
 * at local midnight and when the tab becomes visible again (timers are
 * throttled in the background). Queries that read the clock take it as an
 * argument so they run again on a new day.
 */
export function useLocalToday() {
  const [today, setToday] = useState(() => dateOf(new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setToday(dateOf(now));
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      // A second past, so a timer that fires early still lands on the new day
      timer = setTimeout(refresh, midnight.getTime() - now.getTime() + 1000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return today;
}
