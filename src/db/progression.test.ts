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
const {
  deloadState,
  dismissDeload,
  endDeload,
  isStalled,
  landmarks,
  recentMuscleLoad,
  setFeedback,
  setLandmark,
  startDeload,
  suggestFor,
  weeklyHardSets,
  workSetHistory,
} = await import('./queries/progression')
const { DEFAULT_LANDMARKS } = await import('@/lib/progression')

const BENCH = 1 // chest, con tríceps y hombro anterior de secundarios
const ROW = 2 // back_lats, con bíceps
const SQUAT = 3 // quads, sin secundarios

// Miércoles 26/08/2026, 10:00 local. La semana ISO arranca el lunes 24.
const DAY = 86_400_000
const WED = new Date(2026, 7, 26, 10, 0, 0).getTime()
const MON = new Date(2026, 7, 24, 0, 0, 0).getTime()
const at = (day: number, hour = 10) => new Date(2026, 7, day, hour, 0, 0).getTime()

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM set_entry;
    DELETE FROM session_exercise;
    DELETE FROM session;
    DELETE FROM exercise;
    DELETE FROM settings;
    DELETE FROM sqlite_sequence;
    INSERT INTO settings (id) VALUES (1);
    INSERT INTO exercise (id, name_es, name_en, primary_muscle, secondary_muscles, equipment, metric)
    VALUES (${BENCH}, 'Press banca', 'Bench press', 'chest', '["triceps","shoulders_front"]', 'barbell', 'weight_reps'),
           (${ROW}, 'Remo', 'Row', 'back_lats', '["biceps"]', 'barbell', 'weight_reps'),
           (${SQUAT}, 'Sentadilla', 'Squat', 'quads', null, 'barbell', 'weight_reps');
  `)
})

type Fixture = {
  weightG?: number | null
  reps?: number | null
  kind?: string
  rpe?: number | null
  rir?: number | null
  targetRepsMin?: number | null
  targetRepsMax?: number | null
}

/** Una sesión pasada escrita a mano, con todas sus series completadas a la misma hora. */
function history(exerciseId: number, when: number, sets: Fixture[]): { id: number; seId: number } {
  const id = Number(
    (
      sqlite
        .query(
          "INSERT INTO session (name, started_at, ended_at) VALUES ('vieja', ?, ?) RETURNING id",
        )
        .get(when, when + 3_600_000) as { id: number }
    ).id,
  )
  const seId = Number(
    (
      sqlite
        .query(
          'INSERT INTO session_exercise (session_id, exercise_id, order_index) VALUES (?, ?, 0) RETURNING id',
        )
        .get(id, exerciseId) as { id: number }
    ).id,
  )
  sets.forEach((s, i) => {
    sqlite
      .query(
        `INSERT INTO set_entry
           (session_exercise_id, order_index, kind, weight_g, reps, rpe, rir,
            target_reps_min, target_reps_max, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seId,
        i,
        s.kind ?? 'normal',
        s.weightG ?? null,
        s.reps ?? 8,
        s.rpe ?? null,
        s.rir ?? null,
        s.targetRepsMin ?? null,
        s.targetRepsMax ?? null,
        when,
      )
  })
  return { id, seId }
}

test('the history is newest first, work sets only, and one entry per session', () => {
  history(BENCH, at(17), [{ weightG: 60_000 }, { weightG: 60_000 }])
  const newest = history(BENCH, at(24), [
    { kind: 'warmup', reps: 10, weightG: 100_000 },
    { reps: 9, weightG: 62_500 },
  ])
  history(SQUAT, at(25), [{ weightG: 120_000 }])

  const rows = workSetHistory(BENCH)
  expect(rows).toHaveLength(2)
  expect(rows.map((s) => s.at)).toEqual([at(24), at(17)])
  // La entrada en calor de 100 kg no está: el tope de esa sesión son 62,5.
  expect(rows[0].sets).toEqual([
    { reps: 9, rir: null, rpe: null, targetRepsMax: null, targetRepsMin: null, weightG: 62_500 },
  ])
  expect(workSetHistory(BENCH, { excludeSessionId: newest.id }).map((s) => s.at)).toEqual([at(17)])
  expect(workSetHistory(BENCH, { limit: 1 })).toHaveLength(1)
  expect(workSetHistory(ROW)).toEqual([])
})

test('a full session at the same weight suggests the next rung up', () => {
  history(BENCH, at(17), [{ weightG: 60_000 }, { weightG: 60_000 }])
  history(BENCH, at(24), [{ weightG: 60_000 }, { weightG: 60_000 }])

  // Sin objetivo: repetir las repeticiones de la vez pasada al mismo peso alcanza (E01).
  expect(suggestFor(db, BENCH)).toEqual({ reason: 'linear', weightG: 62_500 })

  // El incremento del ejercicio le gana al de ajustes.
  sqlite.query('UPDATE exercise SET default_increment_g = 5000 WHERE id = ?').run(BENCH)
  expect(suggestFor(db, BENCH)).toEqual({ reason: 'linear', weightG: 65_000 })

  // La sesión que se está entrenando no se sugiere a sí misma.
  const today = history(BENCH, at(26), [{ weightG: 80_000 }])
  expect(suggestFor(db, BENCH, { excludeSessionId: today.id }).weightG).toBe(65_000)
  expect(suggestFor(db, BENCH).weightG).toBe(85_000)
})

test('double progression waits for the top of the range', () => {
  history(BENCH, at(24), [
    { reps: 12, targetRepsMax: 12, targetRepsMin: 8, weightG: 60_000 },
    { reps: 10, targetRepsMax: 12, targetRepsMin: 8, weightG: 60_000 },
  ])
  // El rango que pedía la sesión anterior viaja en la fila: nadie tiene que pasarlo.
  expect(suggestFor(db, BENCH)).toEqual({ reason: 'double', weightG: 60_000 })

  // Con las dos series arriba del rango, sube.
  sqlite.query('UPDATE set_entry SET reps = 12').run()
  expect(suggestFor(db, BENCH)).toEqual({ reason: 'double', weightG: 62_500 })

  // Y el objetivo que manda es el que pasa la rutina de hoy, no el de ayer.
  expect(suggestFor(db, BENCH, { targetRepsMax: 15, targetRepsMin: 12 })).toEqual({
    reason: 'double',
    weightG: 60_000,
  })
})

test('the rep target comes from the first set of the day, not from a back-off', () => {
  history(BENCH, at(24), [
    { reps: 5, targetRepsMax: 5, targetRepsMin: 5, weightG: 100_000 },
    { reps: 12, targetRepsMax: 12, targetRepsMin: 8, weightG: 60_000 },
  ])
  // Manda el 5-5 de arriba: leyendo el back-off de 8-12 la sugerencia se quedaría en 100 kg.
  expect(suggestFor(db, BENCH)).toEqual({ reason: 'double', weightG: 102_500 })
})

test('a warm-up never becomes the suggested weight', () => {
  history(BENCH, at(24), [
    { kind: 'warmup', reps: 5, weightG: 100_000 },
    { reps: 8, weightG: 60_000 },
  ])
  expect(suggestFor(db, BENCH).weightG).toBe(60_000)
  // Y una sesión que fue toda entrada en calor no existe para la sugerencia.
  history(ROW, at(25), [{ kind: 'warmup', reps: 10, weightG: 40_000 }])
  expect(suggestFor(db, ROW)).toEqual({ reason: 'none', weightG: null })
})

test('three sessions without a better estimated 1RM are a stall', () => {
  history(BENCH, at(10), [{ reps: 5, weightG: 100_000 }])
  history(BENCH, at(17), [{ reps: 5, weightG: 100_000 }])
  expect(isStalled(BENCH)).toBe(false) // faltan sesiones

  history(BENCH, at(24), [{ reps: 5, weightG: 100_000 }])
  expect(isStalled(BENCH)).toBe(true)
  // Estancado: 10% abajo, redondeado al incremento (100 × 0,9 = 90).
  expect(suggestFor(db, BENCH)).toEqual({ reason: 'stall', weightG: 90_000 })

  // Una repetición más rompe el empate.
  sqlite.query('UPDATE set_entry SET reps = 6 WHERE completed_at = ?').run(at(24))
  expect(isStalled(BENCH)).toBe(false)
})

test('weekly hard sets count the primary muscle once and every secondary at a half', () => {
  history(BENCH, at(24), [
    { weightG: 60_000 },
    { weightG: 60_000 },
    { kind: 'warmup', weightG: 40_000 },
  ])
  history(ROW, at(25), [{ weightG: 50_000 }])
  // La semana pasada no entra.
  history(SQUAT, at(20), [{ weightG: 120_000 }])

  const week = new Map(weeklyHardSets(MON).map((r) => [r.muscle, r.sets]))
  expect(week.get('chest')).toBe(2) // la entrada en calor no es una serie dura
  expect(week.get('triceps')).toBe(1)
  expect(week.get('shoulders_front')).toBe(1)
  expect(week.get('back_lats')).toBe(1)
  expect(week.get('biceps')).toBe(0.5)
  expect(week.get('quads')).toBe(0)
  // Todos los músculos vuelven, y el más entrenado primero.
  expect(weeklyHardSets(MON)).toHaveLength(schema.MUSCLES.length)
  expect(weeklyHardSets(MON)[0].muscle).toBe('chest')
})

test('deload advice arrives when half of what you train is stalled, and can be silenced', () => {
  for (const id of [BENCH, ROW, SQUAT]) {
    for (const day of [16, 19, 22]) history(id, at(day), [{ reps: 5, weightG: 100_000 }])
  }
  expect(deloadState(WED)).toEqual({
    active: false,
    advise: true,
    reason: 'stall',
    until: null,
  })

  // "Ahora no" calla dos semanas.
  dismissDeload(WED)
  expect(deloadState(WED).advise).toBe(false)
  dismissDeload(WED - 15 * DAY)
  expect(deloadState(WED).advise).toBe(true)

  // Empezarlo lo pone activo, y la sugerencia baja al 60%.
  startDeload()
  const state = deloadState(WED)
  expect(state.active).toBe(true)
  expect(state.advise).toBe(false)
  expect(state.until).not.toBeNull()
  expect(suggestFor(db, BENCH)).toEqual({ reason: 'deload', weightG: 60_000 })

  // Que se venza solo (nadie toca "Terminar") lo apaga y calla las mismas tres semanas.
  sqlite.query('UPDATE settings SET deload_until = ? WHERE id = 1').run(WED - DAY)
  expect(deloadState(WED)).toEqual({ active: false, advise: false, reason: null, until: null })

  // Terminarlo lo apaga y calla tres semanas más.
  endDeload(WED)
  expect(deloadState(WED)).toEqual({ active: false, advise: false, reason: null, until: null })
  expect(suggestFor(db, BENCH).reason).toBe('stall')
  endDeload(WED - 22 * DAY)
  expect(deloadState(WED).advise).toBe(true)
})

test('feedback is saved on the exercise and holds the weight back', () => {
  const { seId } = history(BENCH, at(24), [
    { reps: 12, targetRepsMax: 12, targetRepsMin: 8, weightG: 60_000 },
  ])
  expect(suggestFor(db, BENCH).weightG).toBe(62_500)

  setFeedback(seId, { difficulty: 3, pump: 2 })
  expect(workSetHistory(BENCH)[0].feedback).toEqual({ difficulty: 3, pump: 2 })
  expect(suggestFor(db, BENCH)).toEqual({ reason: 'feedback_hard', weightG: 60_000 })

  setFeedback(seId, null)
  expect(workSetHistory(BENCH)[0].feedback).toBeNull()
  expect(suggestFor(db, BENCH).reason).toBe('double')
})

test('landmarks fall back to the defaults and remember what the user changed', () => {
  expect(landmarks()).toEqual(DEFAULT_LANDMARKS)

  setLandmark('chest', { mav: 18, mev: 10, mrv: 26 })
  expect(landmarks().chest).toEqual({ mav: 18, mev: 10, mrv: 26 })
  setLandmark('quads', { mav: 12, mev: 6, mrv: 18 })
  expect(landmarks().chest).toEqual({ mav: 18, mev: 10, mrv: 26 })
  expect(landmarks().biceps).toEqual(DEFAULT_LANDMARKS.biceps)
})

test('recent muscle load decays and weighs secondaries at a half', () => {
  history(BENCH, WED - 3_600_000, [{ weightG: 60_000 }, { kind: 'warmup', weightG: 40_000 }])
  const load = recentMuscleLoad(WED)
  expect(load.chest).toBeGreaterThan(0)
  expect(load.triceps).toBeCloseTo(load.chest / 2, 6)
  expect(load.back_lats).toBe(0)

  // Diez días atrás está fuera de la ventana de 7.
  history(ROW, WED - 10 * DAY, [{ weightG: 50_000 }])
  expect(recentMuscleLoad(WED).back_lats).toBe(0)
})
