import { useIsFocused } from 'expo-router'
import { addDatabaseChangeListener } from 'expo-sqlite'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

/**
 * Reactive read of a sync query.
 *
 * Contract, same as useMemo: everything `run` closes over goes in `deps`. `run` is captured once
 * per deps identity and re-invoked on every write to any table in `tables` — a stale closure there
 * means stale rows forever, with no warning.
 *
 * `tables: []` means "read once, never refresh" (fine for a snapshot of a finished session, wrong
 * for anything the user can still edit).
 *
 * Only the focused screen re-runs. The tabs keep every screen they have visited mounted, so without
 * this a set tick would also pay for the history tab's `listSessions` (50 rows × 3 correlated
 * subqueries) inside the 150ms completion budget. A blurred screen just records that it is stale and
 * re-runs once, on focus — which for a formSheet over the session screen is the moment it closes.
 */
type Sub = { tables: readonly string[]; active: boolean; stale: boolean; refresh: () => void }

const subs = new Set<Sub>()
let dirty = new Set<string>()
let scheduled = false

/** Blurred screens defer: whoever is on top pays for the write, nobody else. */
function invalidate(s: Sub): void {
  if (s.active) s.refresh()
  else s.stale = true
}

// sqlite3_update_hook fires once PER ROW, so a 30-row transaction must not mean 30 re-runs.
addDatabaseChangeListener(({ tableName }) => {
  dirty.add(tableName)
  if (scheduled) return
  scheduled = true
  setTimeout(() => {
    const touched = dirty
    dirty = new Set()
    scheduled = false
    for (const s of subs) if (s.tables.some((t) => touched.has(t))) invalidate(s)
  }, 0)
})

/** For writes the change listener cannot see (restoring a backup file replaces the whole db). */
export function notifyAll(): void {
  for (const s of subs) invalidate(s)
}

export function useQuery<T>(
  run: () => T,
  tables: readonly string[],
  deps: readonly unknown[] = [],
): T {
  // Safe outside a screen too (the root layout): there the container's navigation is always focused.
  const focused = useIsFocused()

  const store = useMemo(() => {
    let snapshot = run() // sync first read: the first paint already has data
    const listeners = new Set<() => void>()
    const sub: Sub = {
      tables,
      active: true,
      stale: false,
      refresh: () => {
        sub.stale = false
        snapshot = run()
        for (const l of listeners) l()
      },
    }
    return {
      sub,
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

  // Order matters: a write landing between the focus event and this effect leaves `stale` set, and
  // the check below catches it. Nothing is ever dropped, it is only postponed.
  useEffect(() => {
    store.sub.active = focused
    if (focused && store.sub.stale) store.sub.refresh()
  }, [focused, store])

  return useSyncExternalStore(store.subscribe, store.get)
}
