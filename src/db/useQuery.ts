import { addDatabaseChangeListener } from 'expo-sqlite'
import { useMemo, useSyncExternalStore } from 'react'

/**
 * Reactive read of a sync query.
 *
 * Contract, same as useMemo: everything `run` closes over goes in `deps`. `run` is captured once
 * per deps identity and re-invoked on every write to any table in `tables` — a stale closure there
 * means stale rows forever, with no warning.
 *
 * `tables: []` means "read once, never refresh" (fine for a snapshot of a finished session, wrong
 * for anything the user can still edit).
 */
type Sub = { tables: readonly string[]; refresh: () => void }

const subs = new Set<Sub>()
let dirty = new Set<string>()
let scheduled = false

// sqlite3_update_hook fires once PER ROW, so a 30-row transaction must not mean 30 re-runs.
addDatabaseChangeListener(({ tableName }) => {
  dirty.add(tableName)
  if (scheduled) return
  scheduled = true
  setTimeout(() => {
    const touched = dirty
    dirty = new Set()
    scheduled = false
    for (const s of subs) if (s.tables.some((t) => touched.has(t))) s.refresh()
  }, 0)
})

/** For writes the change listener cannot see (restoring a backup file replaces the whole db). */
export function notifyAll(): void {
  for (const s of subs) s.refresh()
}

export function useQuery<T>(
  run: () => T,
  tables: readonly string[],
  deps: readonly unknown[] = [],
): T {
  const store = useMemo(() => {
    let snapshot = run() // sync first read: the first paint already has data
    const listeners = new Set<() => void>()
    const sub: Sub = {
      tables,
      refresh: () => {
        snapshot = run()
        for (const l of listeners) l()
      },
    }
    return {
      get: () => snapshot,
      subscribe: (onStoreChange: () => void) => {
        listeners.add(onStoreChange)
        subs.add(sub)
        return () => {
          listeners.delete(onStoreChange)
          if (listeners.size === 0) subs.delete(sub)
        }
      },
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: `deps` is the caller's contract, see above
  }, deps)

  return useSyncExternalStore(store.subscribe, store.get)
}
