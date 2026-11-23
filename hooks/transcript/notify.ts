/** Calls each listener in turn; one that throws harms neither the caller nor the listeners after it. */
export function notifyAll(listeners: readonly (() => void)[]): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // The listener's own failure
    }
  }
}
