import { Database } from 'bun:sqlite'
import { beforeEach, expect, mock, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'

/** Mismo truco que `stats.test.ts`: bun:sqlite haciendo de expo-sqlite con las migraciones al día. */
const sqlite = new Database(':memory:')
sqlite.exec('PRAGMA foreign_keys = ON')
const dir = join(import.meta.dir, 'migrations')
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  for (const statement of readFileSync(join(dir, file), 'utf8').split('--> statement-breakpoint')) {
    if (statement.trim()) sqlite.exec(statement)
  }
}
const db = drizzle(sqlite, { schema })
mock.module('./client', () => ({ db, ready: Promise.resolve(), sqlite }))

// Dinámico a propósito: los `import` estáticos se izan por encima del `mock.module`.
const { addMetric, deleteMetric, history, latest, latestAll, restoreMetric, series } = await import(
  './queries/body'
)

const DAY_MS = 86_400_000
/** Congelado al cargar: `Date.now()` en cada llamada daba fechas que se corrían un milisegundo. */
const NOW = Date.now()
const day = (n: number) => NOW - n * DAY_MS

beforeEach(() => {
  sqlite.exec('DELETE FROM body_metric; DELETE FROM sqlite_sequence;')
})

test('latest is the newest measurement, not the last one written', () => {
  addMetric('bodyweight', 80_000, day(1))
  const old = addMetric('bodyweight', 90_000, day(30))

  expect(latest('bodyweight')?.value).toBe(80_000)
  expect(latest('waist')).toBeNull()

  // Una medida vieja cargada tarde no destrona a la de ayer.
  expect(latest('bodyweight')?.id).not.toBe(old)
})

test('latestAll gives one row per kind and it is that kind`s newest', () => {
  addMetric('bodyweight', 80_000, day(10))
  addMetric('bodyweight', 79_000, day(2))
  addMetric('waist', 850, day(5))

  const all = latestAll()
  expect(Object.keys(all).sort()).toEqual(['bodyweight', 'waist'])
  expect(all.bodyweight?.value).toBe(79_000)
  expect(all.bodyweight?.measuredAt).toBe(day(2))
  expect(all.waist?.value).toBe(850)
  expect(all.chest).toBeUndefined()
})

test('series is the window, oldest first; history is everything, newest first', () => {
  addMetric('waist', 900, day(120))
  addMetric('waist', 880, day(60))
  addMetric('waist', 860, day(1))

  expect(series('waist', 90).map((r) => r.value)).toEqual([880, 860])
  expect(history('waist', 50).map((r) => r.value)).toEqual([860, 880, 900])
  expect(series('chest', 90)).toEqual([])
})

test('deleting returns the row and restoring puts it back with the same id', () => {
  const id = addMetric('arm_left', 380, day(3))
  const newer = addMetric('arm_left', 385, day(1))

  const deleted = deleteMetric(id)
  expect(deleted).toMatchObject({ id, kind: 'arm_left', measuredAt: day(3), value: 380 })
  expect(history('arm_left', 50)).toHaveLength(1)

  restoreMetric(deleted)
  const back = history('arm_left', 50)
  expect(back.map((r) => r.id)).toEqual([newer, id])
  expect(back[1]).toEqual(deleted)
  expect(() => deleteMetric(id + 999)).toThrow()
})
