// What the shell hands down through the router outlet. It lives in its own module because both
// the shell that provides it and every page that consumes it need the type, and a page importing
// it from another page would tie the two together for no reason.

/** How often the index has reported a change, counted rather than signalled. */
export interface IndexRevisions {
  /** Per note path. Never reset, so a per-note count only ever goes up. */
  notes: Record<string, number>;
  /** Whole-index rebuilds, which invalidate every note at once. */
  rebuilds: number;
  /** Every event, of any kind. For a view that depends on the index as a whole. */
  events: number;
}

export interface OutletContext {
  revisions: IndexRevisions;
}
