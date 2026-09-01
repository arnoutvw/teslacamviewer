import '@testing-library/jest-dom/vitest'

// jsdom ships a working localStorage, but vitest 3.2.7's populateGlobal copies
// it as an accessor that resolves to undefined (vitest/jsdom interplay bug).
// Detect that and install an in-memory Storage shim so code under test can use
// the real API surface (getItem/setItem/removeItem/clear/length/key).
let storageBroken = false
try {
  localStorage.setItem('__probe__', 'v')
  storageBroken = localStorage.getItem('__probe__') !== 'v'
  localStorage.removeItem('__probe__')
} catch {
  storageBroken = true
}
if (storageBroken) {
  const store = new Map<string, string>()
  const shim: Storage = {
    get length(): number {
      return store.size
    },
    clear(): void {
      store.clear()
    },
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true })
}