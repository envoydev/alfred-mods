// Small helpers over arrays: keep the newest entries of a list

export function keepNewest<K>(items: Map<K, unknown> | Set<K>, limit = 500): void {
  for (const k of items.keys()) {
    if (items.size <= limit) return
    items.delete(k)
  }
}


