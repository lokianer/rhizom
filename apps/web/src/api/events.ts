// The index events the server streams while files change on disk. EventSource reconnects on
// its own, so a restarted server simply resumes the stream.
import type { IndexEvent } from '@rhizom/core';

export type IndexEventListener = (event: IndexEvent) => void;

/** Subscribes to `/api/events`; the returned function closes the stream. */
export function subscribeToIndexEvents(listener: IndexEventListener): () => void {
  const source = new EventSource('/api/events');
  const handle = (event: MessageEvent<string>): void => {
    try {
      listener(JSON.parse(event.data) as IndexEvent);
    } catch {
      // A partial or unknown payload is not worth breaking the stream over.
    }
  };
  for (const type of ['indexed', 'removed', 'rebuilt']) {
    source.addEventListener(type, handle);
  }
  return () => {
    source.close();
  };
}
