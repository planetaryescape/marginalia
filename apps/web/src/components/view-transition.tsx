"use client";
import * as React from "react";

type Mapping = string | { [type: string]: string };

type ViewTransitionProps = {
  name?: string;
  share?: Mapping;
  enter?: Mapping;
  exit?: Mapping;
  default?: Mapping;
  children: React.ReactNode;
};

// App Router bundles React canary, which exports ViewTransition; the installed
// react (19.2) and its types do not. Without it (tests, an older runtime) the
// children render as they are and navigation just swaps.
const Native = (
  React as unknown as {
    ViewTransition?: React.ComponentType<ViewTransitionProps>;
  }
).ViewTransition;

export function ViewTransition(props: ViewTransitionProps): React.ReactNode {
  return Native ? <Native {...props} /> : props.children;
}

/** Transition types set on navigations, matched by `:active-view-transition-type()` in globals.css. */
export const OPEN_ARTICLE = "open-article";
export const FINISH_ARTICLE = "finish-article";
