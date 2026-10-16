"use client";
import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Rendered in place of the children after a failed query; `retry` remounts them. */
  fallback: (retry: () => void) => ReactNode;
};

/**
 * A failed Convex query throws during render. This keeps the failure inside
 * the part of the desk that asked, so the header and the bar keep working.
 */
export class QueryBoundary extends Component<
  Props,
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error("Couldn't load part of the desk", error);
  }

  retry = () =>
    this.setState(({ attempt }) => ({ failed: false, attempt: attempt + 1 }));

  render() {
    if (this.state.failed) {
      return this.props.fallback(this.retry);
    }
    return (
      <div key={this.state.attempt} className="contents">
        {this.props.children}
      </div>
    );
  }
}
