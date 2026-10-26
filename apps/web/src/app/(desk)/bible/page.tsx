import { Suspense } from "react";
import { BibleStudy } from "@/components/bible-study";

export default function BiblePage() {
  return (
    <Suspense
      fallback={
        <p className="px-5 py-10" role="status">
          Opening Bible study…
        </p>
      }
    >
      <BibleStudy />
    </Suspense>
  );
}
