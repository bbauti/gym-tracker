import { Database } from 'bun:sqlite'
import { beforeEach, expect, mock, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'

/** Mismo truco que `routines.test.ts`: bun:sqlite haciendo de expo-sqlite con las migraciones al día. */
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
const { listSessions, searchSessions } = await import('./queries/history')
const { startOfDay } = await import('./queries/stats')

const BENCH = 1
const SQUAT = 2

/** Agosto de 2026 en hora local: el filtro por día es medianoche local, no UTC. */
const at = (day: number, hour = 10) => new Date(2026, 7, day, hour, 0, 0).getTime()

beforeEach(() => {
  sqlite.exec(`
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

/** Una sesión terminada con un ejercicio y una serie completada. */
function workout(opts: {
  name?: string | null
  note?: string | null
  startedAt: number
  exerciseId?: number
  exerciseNote?: string | null
}): number {
  const sessionId = Number(
    (
      sqlite
        .query(
          `INSERT INTO session (name, note, started_at, ended_at)
           VALUES (?, ?, ?, ?) RETURNING id`,
        )
        .get(opts.name ?? null, opts.note ?? null, opts.startedAt, opts.startedAt + 3_600_000) as {
        id: number
      }
    ).id,
  )
  const seId = Number(
    (
      sqlite
        .query(
          `INSERT INTO session_exercise (session_id, exercise_id, order_index, note)
           VALUES (?, ?, 0, ?) RETURNING id`,
        )
        .get(sessionId, opts.exerciseId ?? BENCH, opts.exerciseNote ?? null) as { id: number }
    ).id,
  )
  sqlite
    .query(
      `INSERT INTO set_entry (session_exercise_id, order_index, kind, weight_g, reps, completed_at)
       VALUES (?, 0, 'normal', 60000, 8, ?)`,
    )
    .run(seId, opts.startedAt + 60_000)
  return sessionId
}

const names = (rows: { session: { name: string | null } }[]) => rows.map((r) => r.session.name)

test('el filtro por día usa la medianoche local y el momento en el que EMPEZÓ la sesión', () => {
  workout({ name: 'Martes', startedAt: at(25) })
  const late = workout({ name: 'Miércoles tarde', startedAt: at(26, 23) })
  workout({ name: 'Miércoles', startedAt: at(26, 9) })
  workout({ name: 'Jueves', startedAt: at(27) })

  // Sin filtro, todo el historial, de lo más nuevo a lo más viejo.
  expect(names(listSessions())).toEqual(['Jueves', 'Miércoles tarde', 'Miércoles', 'Martes'])

  expect(names(listSessions({ day: startOfDay(at(26)) }))).toEqual(['Miércoles tarde', 'Miércoles'])
  // La que arrancó a las 23:00 terminó pasada la medianoche y sigue siendo del miércoles.
  expect(listSessions({ day: startOfDay(at(27)) }).map((r) => r.session.id)).not.toContain(late)
  expect(names(listSessions({ day: startOfDay(at(27)) }))).toEqual(['Jueves'])
  expect(listSessions({ day: startOfDay(at(24)) })).toEqual([])
})

test('la búsqueda mira el nombre, las notas y los ejercicios en los dos idiomas', () => {
  workout({ name: 'Torso', startedAt: at(20) })
  workout({ name: 'Pierna', exerciseId: SQUAT, startedAt: at(21) })
  workout({ name: null, note: 'me dolió el hombro', startedAt: at(22) })
  workout({ exerciseNote: 'agarre cerrado', name: 'Libre', startedAt: at(23) })

  // Nombre de la sesión, sin importar mayúsculas.
  expect(names(searchSessions('torso'))).toEqual(['Torso'])
  // Nota de la sesión y nota del ejercicio.
  expect(names(searchSessions('hombro'))).toEqual([null])
  expect(names(searchSessions('agarre'))).toEqual(['Libre'])
  // El catálogo, en español y en inglés: la sesión ni se llama así.
  expect(names(searchSessions('banca'))).toEqual(['Libre', null, 'Torso'])
  expect(names(searchSessions('squat'))).toEqual(['Pierna'])
  expect(searchSessions('kettlebell')).toEqual([])
  // Vacío = el historial entero, no cero resultados.
  expect(searchSessions('   ')).toHaveLength(4)
})

test('los comodines de LIKE los escribe el usuario, no la query', () => {
  workout({ name: '100% pierna', startedAt: at(20) })
  workout({ name: 'Torso', startedAt: at(21) })

  expect(names(searchSessions('100%'))).toEqual(['100% pierna'])
  // Sin escapar, `%` sola devolvía las dos.
  expect(names(searchSessions('%'))).toEqual(['100% pierna'])
  expect(searchSessions('_orso')).toEqual([])
})
