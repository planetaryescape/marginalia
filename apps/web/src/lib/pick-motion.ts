/** Mirrors `--motion-move` and `--motion-quick` in globals.css; framer-motion can't read CSS variables. */
const EASE = [0.2, 0.8, 0.2, 1] as const;
export const MOVE = { duration: 0.24, ease: EASE } as const;
export const QUICK = { duration: 0.16, ease: EASE } as const;

/**
 * How the desk's pick changes. The first pick has nowhere to slide from
 * (`direction` is 0), so it only fades in, at the quick time, or not at all
 * with reduced motion. Later picks slide as before.
 */
export function pickTransition(direction: number, reduced: boolean | null) {
  if (reduced) return { duration: 0 };
  if (direction !== 0) return MOVE;
  return QUICK;
}
