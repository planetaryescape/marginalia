import type { ReactNode } from "react";

/** Shared content alignment and heading for the reading desk's collection pages. */
export function DeskPage({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[1180px] px-5 md:px-10 pt-[clamp(0.75rem,4vh,3rem)] pb-10">
      <div className="max-w-3xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="font-serif font-light tracking-tight text-[clamp(2rem,4vw,3.5rem)] leading-tight">
            {title}
          </h1>
          {action}
        </div>
        {children}
      </div>
    </main>
  );
}
