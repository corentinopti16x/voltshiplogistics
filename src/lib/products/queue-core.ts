/** Where a product stands in the list of products still to quote, and its neighbours. */
export type QueueItem = { id: string; title: string };

export type QueuePosition = {
  /** 1-based position; null when the product is not (or no longer) to quote. */
  position: number | null;
  total: number;
  previous: QueueItem | null;
  /** Next product to quote; the first of the list when this product is not in it. */
  next: QueueItem | null;
};

export function queuePosition(queue: QueueItem[], id: string): QueuePosition {
  const index = queue.findIndex((item) => item.id === id);
  if (index < 0)
    return { position: null, total: queue.length, previous: null, next: queue[0] ?? null };
  return {
    position: index + 1,
    total: queue.length,
    previous: queue[index - 1] ?? null,
    next: queue[index + 1] ?? null,
  };
}
