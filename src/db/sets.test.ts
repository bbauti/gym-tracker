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
const { addSet, addWarmupSets, completeSet, prevSets } = await import('./queries/sets')
const { addExercise, createSession, getSessionTree } = await import('./queries/session')

const BENCH = 1

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM set_entry;
    DELETE FROM session_exercise;
    DELETE FROM session;
    DELETE FROM exercise;
    DELETE FROM sqlite_sequence;
    INSERT OR IGNORE INTO settings (id) VALUES (1);
    INSERT INTO exercise (id, name_es, name_en, primary_muscle, equipment, metric)
    VALUES (${BENCH}, 'Press banca', 'Bench press', 'chest', 'barbell', 'weight_reps');
  `)
})

function seId(): number {
  const sessionId = createSession()
  return addExercise(sessionId, BENCH)
}

test('las series de entrada en calor entran arriba y corren a las que ya estaban', () => {
  const id = seId()
  addSet(id) // `addExercise` ya dejó una: quedan dos de trabajo
  addWarmupSets(id, [
    { weightG: 20_000, reps: 10 },
    { weightG: 60_000, reps: 5 },
  ])

  const sets = getSessionTree(1)?.exercises[0].sets ?? []
  expect(sets.map((s) => s.orderIndex)).toEqual([0, 1, 2, 3])
  expect(sets.map((s) => s.kind)).toEqual(['warmup', 'warmup', 'normal', 'normal'])
  expect(sets.map((s) => s.weightG)).toEqual([20_000, 60_000, null, null])
  expect(sets.map((s) => s.reps)).toEqual([10, 5, null, null])
})

test('sin filas no escribe nada', () => {
  const id = seId()
  addWarmupSets(id, [])
  expect(getSessionTree(1)?.exercises[0].sets).toHaveLength(1)
})

test('los fantasmas de la vez anterior salen sin las entradas en calor', () => {
  const before = createSession({ startedAt: Date.parse('2026-08-19T10:00:00Z') })
  const se = addExercise(before, BENCH)
  addSet(se) // dos de trabajo
  addWarmupSets(se, [{ weightG: 20_000, reps: 12 }])
  for (const set of getSessionTree(before)?.exercises[0].sets ?? []) {
    const warm = set.kind === 'warmup'
    completeSet(set.id, before, { reps: warm ? 12 : 5, weightG: warm ? 20_000 : 80_000 }, null)
  }

  const now = createSession({ startedAt: Date.parse('2026-08-26T10:00:00Z') })
  addExercise(now, BENCH)

  // Alinear por índice absoluto es lo que rompe agregar una rampa a mitad de sesión: los fantasmas
  // vienen solo de las series de trabajo, en su orden.
  const ghosts = prevSets(BENCH, now)
  expect(ghosts.map((g) => g.kind)).toEqual(['normal', 'normal'])
  expect(ghosts.map((g) => g.weightG)).toEqual([80_000, 80_000])
})
