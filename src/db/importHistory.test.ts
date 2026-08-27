import { Database } from 'bun:sqlite'
import { beforeEach, expect, mock, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { parseHistoryCsv } from '@/lib/historyCsv'
import * as schema from './schema'

/** Mismo truco que `history.test.ts`: bun:sqlite haciendo de expo-sqlite con las migraciones al día. */
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
const { importHistory } = await import('./queries/importHistory')

const BENCH = 1
const SQUAT = 2

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM personal_record;
    DELETE FROM set_entry;
    DELETE FROM session_exercise;
    DELETE FROM session;
    DELETE FROM exercise;
    DELETE FROM sqlite_sequence;
    INSERT OR IGNORE INTO settings (id) VALUES (1);
    INSERT INTO exercise (id, name_es, name_en, primary_muscle, equipment, metric)
    VALUES (${BENCH}, 'Press banca', 'Bench press', 'chest', 'barbell', 'weight_reps'),
           (${SQUAT}, 'Sentadilla', 'Squat', 'quads', 'barbell', 'weight_reps');
  `)
})

const HEADER = 'date,session_name,exercise_es,exercise_en,set_index,kind,weight_kg,reps,completed'

const TWO_SESSIONS = [
  HEADER,
  '2026-08-25T10:00:00,Torso,Press banca,Bench press,1,normal,60,8,1',
  '2026-08-25T10:05:00,Torso,Press banca,Bench press,2,normal,62.5,6,1',
  '2026-08-25T10:10:00,Torso,Sentadilla,Squat,1,normal,100,5,1',
  '2026-08-26T10:00:00,Pierna,Sentadilla,Squat,1,normal,105,5,1',
  '2026-08-26T10:05:00,Pierna,Press banca,Bench press,1,normal,65,5,1',
].join('\r\n')

function parse(text: string) {
  const parsed = parseHistoryCsv(text)
  if (!parsed) throw new Error('el CSV del test no se entiende')
  return parsed
}

const rows = <T>(sql: string): T[] => sqlite.query(sql).all() as T[]
const count = (table: string) => rows<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)[0].n

test('mete las sesiones, los ejercicios y las series del archivo', () => {
  const result = importHistory(parse(TWO_SESSIONS))
  expect(result).toEqual({ created: [], duplicates: 0, sessions: 2, sets: 5 })

  expect(
    rows<{ name: string; started_at: number; ended_at: number }>(
      'SELECT name, started_at, ended_at FROM session ORDER BY started_at',
    ).map((s) => [s.name, s.ended_at - s.started_at]),
  ).toEqual([
    ['Torso', 10 * 60_000 + 120_000],
    ['Pierna', 5 * 60_000 + 120_000],
  ])

  // Los ejercicios quedan en el orden en el que aparecieron en el archivo, por sesión.
  expect(
    rows<{ name: string; exercise_id: number; order_index: number }>(`
      SELECT s.name, sx.exercise_id, sx.order_index FROM session_exercise sx
      JOIN session s ON s.id = sx.session_id ORDER BY s.started_at, sx.order_index
    `).map((r) => [r.name, r.exercise_id, r.order_index]),
  ).toEqual([
    ['Torso', BENCH, 0],
    ['Torso', SQUAT, 1],
    ['Pierna', SQUAT, 0],
    ['Pierna', BENCH, 1],
  ])

  const sets = rows<{ order_index: number; weight_g: number; reps: number; completed_at: number }>(`
    SELECT st.order_index, st.weight_g, st.reps, st.completed_at FROM set_entry st
    JOIN session_exercise sx ON sx.id = st.session_exercise_id
    JOIN session s ON s.id = sx.session_id
    WHERE s.name = 'Torso' AND sx.exercise_id = ${BENCH} ORDER BY st.order_index
  `)
  // `order_index` arranca en 0 aunque el archivo numere desde 1.
  expect(sets.map((s) => [s.order_index, s.weight_g, s.reps])).toEqual([
    [0, 60_000, 8],
    [1, 62_500, 6],
  ])
  expect(sets[1].completed_at - sets[0].completed_at).toBe(5 * 60_000)
})

test('un ejercicio que no está en el catálogo se crea como propio', () => {
  const result = importHistory(
    parse(
      [
        'date,exercise_es,exercise_en,weight_kg,reps',
        '2026-08-25 10:00,Hip thrust,,80,10',
        // El catálogo se matchea también por el nombre en inglés y sin acentos.
        '2026-08-25 10:10,,Bench press,60,8',
        '2026-08-25 10:20,PRESS BANCA,,62,8',
      ].join('\n'),
    ),
  )

  expect(result.created).toEqual(['Hip thrust'])
  expect(
    rows<{ name_es: string; name_en: string; is_custom: number }>(
      'SELECT name_es, name_en, is_custom FROM exercise WHERE is_custom = 1',
    ),
  ).toEqual([{ is_custom: 1, name_en: 'Hip thrust', name_es: 'Hip thrust' }])
  // Tres filas, dos ejercicios: las dos del press banca cayeron en el del catálogo.
  expect(count('session_exercise')).toBe(2)
  expect(count('set_entry')).toBe(3)
})

test('después de importar hay récords, que salen del historial que entró', () => {
  importHistory(parse(TWO_SESSIONS))

  const prs = rows<{ exercise_id: number; kind: string; value_g: number }>(
    'SELECT exercise_id, kind, value_g FROM personal_record ORDER BY exercise_id, kind, value_g',
  )
  expect(prs.length).toBeGreaterThan(0)
  // El mejor peso de sentadilla es el del segundo día, no el del primero.
  const weights = prs.filter((p) => p.exercise_id === SQUAT && p.kind === 'weight')
  expect(weights.at(-1)?.value_g).toBe(105_000)
  expect(count('set_entry WHERE is_pr = 1')).toBeGreaterThan(0)
})

test('importar el mismo archivo dos veces no duplica nada', () => {
  importHistory(parse(TWO_SESSIONS))
  const before = [count('session'), count('session_exercise'), count('set_entry')]

  const again = importHistory(parse(TWO_SESSIONS))
  expect(again).toEqual({ created: [], duplicates: 2, sessions: 0, sets: 0 })
  expect([count('session'), count('session_exercise'), count('set_entry')]).toEqual(before)
})

test('la sesión que ya se entrenó en la app tampoco se duplica al importar su export', () => {
  // Su `started_at` real es anterior a la primera serie, así que el inicio que reconstruye el CSV
  // (9:59) nunca coincide: lo que la identifica es el nombre y que los horarios se pisen.
  const startedAt = new Date(2026, 7, 25, 9, 55).getTime()
  sqlite.exec(
    `INSERT INTO session (name, started_at, ended_at)
     VALUES ('Torso', ${startedAt}, ${startedAt + 20 * 60_000})`,
  )

  const result = importHistory(parse(TWO_SESSIONS))
  expect(result).toMatchObject({ duplicates: 1, sessions: 1, sets: 2 })
  expect(count('session')).toBe(2)
})

test('la unidad del archivo: lb por opción, y la columna `unit` por fila le gana', () => {
  const result = importHistory(
    parse(
      [
        'date,exercise_es,weight_kg,reps,unit',
        '2026-08-25 10:00,Press banca,100,5,',
        '2026-08-25 10:05,Press banca,100,5,kg',
      ].join('\n'),
    ),
    { unit: 'lb' },
  )
  expect(result.sets).toBe(2)
  expect(
    rows<{ weight_g: number }>('SELECT weight_g FROM set_entry ORDER BY order_index').map(
      (s) => s.weight_g,
    ),
  ).toEqual([45_359, 100_000])
})
