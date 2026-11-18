// Keeps a Map or a Set to its newest entries, by the order they were added

export function keepNewest<K>(items: Map<K, unknown> | Set<K>, limit = 500): void {
  for (const k of items.keys()) {
    if (items.size <= limit) return
    items.delete(k)
  }
}


