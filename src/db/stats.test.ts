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
const { backfillPrs, currentBests, listPrs, recomputeExercisePrs } = await import('./queries/prs')
const { addSet, completeSet, deleteSet, getSet, restoreSet, uncompleteSet, updateSet } =
  await import('./queries/sets')
const {
  addExercise,
  createSession,
  deleteSession,
  removeSessionExercise,
  restoreSessionExercise,
  swapExercise,
  updateSession,
} = await import('./queries/session')
const {
  addDays,
  exerciseSeries,
  neglectedMuscles,
  pushPullBalance,
  sessionVolume,
  startOfWeek,
  streakWeeks,
  thisAndLastWeek,
  totalTonnageG,
  trainingDays,
  volumeByMuscle,
  weekSummary,
} = await import('./queries/stats')

const BENCH = 1 // chest, push_h
const ROW = 2 // back_lats, pull_h
const SQUAT = 3 // quads, squat

// Miércoles 26/08/2026, 10:00 local. La semana ISO arranca el lunes 24.
const WED = new Date(2026, 7, 26, 10, 0, 0).getTime()
const MON = new Date(2026, 7, 24, 0, 0, 0).getTime()
const at = (day: number, hour = 10) => new Date(2026, 7, day, hour, 0, 0).getTime()

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM personal_record;
    DELETE FROM set_entry;
    DELETE FROM session_exercise;
    DELETE FROM session;
    DELETE FROM exercise;
    DELETE FROM sqlite_sequence;
    INSERT OR IGNORE INTO settings (id) VALUES (1);
    INSERT INTO exercise (id, name_es, name_en, primary_muscle, equipment, pattern, metric)
    VALUES (${BENCH}, 'Press banca', 'Bench press', 'chest', 'barbell', 'push_h', 'weight_reps'),
           (${ROW}, 'Remo', 'Row', 'back_lats', 'barbell', 'pull_h', 'weight_reps'),
           (${SQUAT}, 'Sentadilla', 'Squat', 'quads', 'barbell', 'squat', 'weight_reps');
  `)
})

type Fixture = { weightG?: number | null; reps?: number | null; kind?: string; at: number }

/** Una sesión vieja escrita a mano: no pasa por `completeSet`, así que no deja récords. */
function history(
  exerciseId: number,
  sets: Fixture[],
  span: { startedAt?: number; endedAt?: number | null; pausedMs?: number } = {},
): number {
  const startedAt = span.startedAt ?? sets[0]?.at ?? 0
  const endedAt =
    span.endedAt === undefined ? (sets[sets.length - 1]?.at ?? startedAt) : span.endedAt
  const sessionId = Number(
    (
      sqlite
        .query(
          `INSERT INTO session (name, started_at, ended_at, paused_ms)
           VALUES ('vieja', ?, ?, ?) RETURNING id`,
        )
        .get(startedAt, endedAt, span.pausedMs ?? 0) as { id: number }
    ).id,
  )
  const seId = Number(
    (
      sqlite
        .query(
          'INSERT INTO session_exercise (session_id, exercise_id, order_index) VALUES (?, ?, 0) RETURNING id',
        )
        .get(sessionId, exerciseId) as { id: number }
    ).id,
  )
  sets.forEach((s, i) => {
    sqlite
      .query(
        `INSERT INTO set_entry (session_exercise_id, order_index, kind, weight_g, reps, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(seId, i, s.kind ?? 'normal', s.weightG ?? null, s.reps ?? 8, s.at)
  })
  return sessionId
}

/** Una serie de verdad, por la puerta de la app: `addSet` + `completeSet`. */
function live(sessionId: number, seId: number, weightG: number | null, reps: number | null) {
  const setId = addSet(seId)
  return { kinds: completeSet(setId, sessionId, { reps, weightG }, null), setId }
}

const kindsOf = (exerciseId: number) =>
  listPrs(exerciseId)
    .map((p) => p.kind)
    .sort()

test('completing a set records every kind it broke, inside the same transaction', () => {
  const sessionId = createSession()
  const seId = addExercise(sessionId, BENCH)

  const first = live(sessionId, seId, 60_000, 8)
  expect(first.kinds).toEqual(['weight', 'volume', 'e1rm'])
  expect(getSet(first.setId)?.isPr).toBe(true)
  expect(listPrs(BENCH)).toHaveLength(3)
  expect(listPrs(BENCH).every((p) => p.setEntryId === first.setId && p.set.reps === 8)).toBe(true)

  // Mismo peso, una repetición más: el récord de reps a ese peso y, de paso, volumen y 1RM.
  const second = live(sessionId, seId, 60_000, 9)
  expect(second.kinds).toEqual(['reps_at_weight', 'volume', 'e1rm'])
  const repsPr = listPrs(BENCH).find((p) => p.kind === 'reps_at_weight')
  expect(repsPr?.reps).toBe(9)
  expect(repsPr?.valueG).toBe(60_000) // "9 reps" sin decir a cuánto no es un récord

  // Repetir lo de recién no es un récord, y la fila no se lleva el badge.
  const third = live(sessionId, seId, 60_000, 9)
  expect(third.kinds).toEqual([])
  expect(getSet(third.setId)?.isPr).toBe(false)

  expect(currentBests(BENCH)).toEqual({ e1rmG: 78_000, volumeG: 540_000, weightG: 60_000 })
  expect(currentBests(SQUAT)).toEqual({ e1rmG: null, volumeG: null, weightG: null })
})

test('a warm-up never makes a record', () => {
  const sessionId = createSession()
  const seId = addExercise(sessionId, BENCH)
  const setId = addSet(seId)
  updateSet(setId, { kind: 'warmup' })

  expect(completeSet(setId, sessionId, { reps: 5, weightG: 200_000 }, null)).toEqual([])
  expect(getSet(setId)?.isPr).toBe(false)
  expect(listPrs(BENCH)).toHaveLength(0)

  // Y tampoco sube la vara: la primera serie de trabajo, mucho más liviana, sigue siendo récord.
  // (`addSet` copia el tipo de la anterior — "una más igual" —, así que hay que volverla normal.)
  const work = addSet(seId)
  updateSet(work, { kind: 'normal' })
  expect(completeSet(work, sessionId, { reps: 8, weightG: 60_000 }, null)).toEqual([
    'weight',
    'volume',
    'e1rm',
  ])
})

test('deleting a set replays the exercise instead of only dropping its own records', () => {
  const sessionId = createSession()
  const seId = addExercise(sessionId, BENCH)
  const light = live(sessionId, seId, 60_000, 8) // 480 kg de volumen
  const heavy = live(sessionId, seId, 80_000, 5) // más peso, menos volumen
  expect(heavy.kinds).toEqual(['weight', 'e1rm'])

  // Se borra la primera: el volumen que tapaba a la segunda deja de existir y pasa a ser suyo.
  deleteSet(light.setId)
  expect(kindsOf(BENCH)).toEqual(['e1rm', 'volume', 'weight'])
  expect(listPrs(BENCH).every((p) => p.setEntryId === heavy.setId)).toBe(true)
  expect(getSet(heavy.setId)?.isPr).toBe(true)
  expect(currentBests(BENCH)).toEqual({ e1rmG: 93_333, volumeG: 400_000, weightG: 80_000 })
})

test('un-ticking a set hands the records back to the one before it', () => {
  const sessionId = createSession()
  const seId = addExercise(sessionId, BENCH)
  const first = live(sessionId, seId, 60_000, 8)
  const second = live(sessionId, seId, 60_000, 12)
  expect(second.kinds).toEqual(['reps_at_weight', 'volume', 'e1rm'])

  uncompleteSet(second.setId)
  expect(getSet(second.setId)?.isPr).toBe(false)
  expect(getSet(first.setId)?.isPr).toBe(true)
  expect(listPrs(BENCH).every((p) => p.setEntryId === first.setId)).toBe(true)
  expect(currentBests(BENCH).volumeG).toBe(480_000)
})

test('editing a completed set moves its record with it', () => {
  const sessionId = createSession()
  const seId = addExercise(sessionId, BENCH)
  const { setId } = live(sessionId, seId, 100_000, 5)
  expect(currentBests(BENCH).weightG).toBe(100_000)

  updateSet(setId, { weightG: 90_000 })
  expect(currentBests(BENCH).weightG).toBe(90_000)

  // Una nota no es un récord: no hace falta reproducir nada, y nada se rompe.
  updateSet(setId, { note: 'buena' })
  expect(currentBests(BENCH).weightG).toBe(90_000)

  // Reescribir el mismo peso tampoco lo es (`flush()` manda el patch entero en cada blur).
  updateSet(setId, { reps: 5, weightG: 90_000 })
  expect(currentBests(BENCH).weightG).toBe(90_000)
  expect(getSet(setId)?.isPr).toBe(true)

  // Pasarla a entrada en calor la saca del historial por completo.
  updateSet(setId, { kind: 'warmup' })
  expect(listPrs(BENCH)).toHaveLength(0)
  expect(getSet(setId)?.isPr).toBe(false)
})

test('undoing a delete puts the records back', () => {
  const sessionId = createSession()
  const seId = addExercise(sessionId, BENCH)
  live(sessionId, seId, 60_000, 8)
  const second = live(sessionId, seId, 80_000, 8)
  const before = listPrs(BENCH).map((p) => [p.kind, p.setEntryId, p.valueG])

  const row = deleteSet(second.setId)
  expect(kindsOf(BENCH)).toEqual(['e1rm', 'volume', 'weight'])

  restoreSet(row)
  expect(listPrs(BENCH).map((p) => [p.kind, p.setEntryId, p.valueG])).toEqual(before)
  expect(getSet(second.setId)?.isPr).toBe(true)
})

test('replaying an exercise gives exactly what the live recording gave', () => {
  const sessionId = createSession()
  const seId = addExercise(sessionId, BENCH)
  for (const [w, r] of [
    [60_000, 8],
    [60_000, 10],
    [80_000, 5],
    [80_000, 5],
    [100_000, 1],
    [70_000, 12],
  ] as const) {
    live(sessionId, seId, w, r)
  }
  const shape = () => listPrs(BENCH, 50).map((p) => [p.kind, p.setEntryId, p.valueG, p.reps])
  const before = shape()
  expect(before.length).toBeGreaterThan(3)

  recomputeExercisePrs(BENCH)
  expect(shape()).toEqual(before)
})

test('the week starts on monday and nothing leaks between weeks', () => {
  // Domingo 23 a las 23:00 (semana pasada) y lunes 24 a las 00:00 en punto (esta).
  history(BENCH, [{ at: at(23, 23), reps: 10, weightG: 50_000 }], {
    endedAt: at(23, 23) + 40 * 60_000,
    startedAt: at(23, 23),
  })
  // Martes 18: la semana pasada, pero antes del miércoles 10:00 en el que se para el test.
  history(BENCH, [{ at: at(18, 9), reps: 10, weightG: 40_000 }], {
    endedAt: at(18, 9) + 30 * 60_000,
    startedAt: at(18, 9),
  })
  history(BENCH, [{ at: MON }, { at: at(24, 11), kind: 'warmup', weightG: 200_000 }], {
    endedAt: MON + 60 * 60_000,
    pausedMs: 10 * 60_000,
    startedAt: MON,
  })
  history(BENCH, [{ at: at(25, 18), reps: 5, weightG: 100_000 }], {
    endedAt: at(25, 19),
    startedAt: at(25, 18),
  })

  // G11 corta las dos semanas en el mismo punto: "hasta el miércoles 10:00" contra "hasta el
  // miércoles 10:00". El domingo pasado a las 23:00 queda afuera — a esta altura de la semana
  // todavía no había pasado, y compararlo contra una semana completa dibujaría un ▼ que solo dice
  // qué día es hoy.
  const { current, previous } = thisAndLastWeek(WED)
  expect(previous).toEqual({
    durationMs: 30 * 60_000,
    sessions: 1,
    sets: 1,
    volumeG: 400_000,
  })
  // La semana pasada entera sí lo cuenta.
  expect(weekSummary(addDays(MON, -7), MON)).toEqual({
    durationMs: 70 * 60_000,
    sessions: 2,
    sets: 2,
    volumeG: 900_000,
  })
  expect(current.sessions).toBe(2)
  expect(current.sets).toBe(2) // la entrada en calor no cuenta
  expect(current.volumeG).toBe(0 + 500_000) // 8 reps sin peso + 100 kg × 5
  expect(current.durationMs).toBe(50 * 60_000 + 60 * 60_000) // reloj menos pausa

  // Lo que todavía no pasó no entra: parado el lunes al mediodía, el martes no existe.
  expect(weekSummary(MON, at(24, 12)).sessions).toBe(1)
  expect(weekSummary(MON, at(24, 12)).sets).toBe(1)
  expect(startOfWeek(at(23, 23))).toBe(addDays(MON, -7))
})

test('a session still running counts its sets but not as a finished workout', () => {
  const open = history(BENCH, [{ at: at(26, 9), reps: 6, weightG: 100_000 }], {
    endedAt: null,
    startedAt: at(26, 9),
  })
  const { current } = thisAndLastWeek(WED)
  expect(current.sessions).toBe(0)
  expect(current.durationMs).toBe(0)
  expect(current.sets).toBe(1)
  expect(sessionVolume(open)).toEqual({ sets: 1, volumeG: 600_000 })
  expect(totalTonnageG()).toBe(600_000)
})

test('exerciseSeries goes oldest first and keeps the newest N sessions', () => {
  history(BENCH, [{ at: at(10), reps: 10, weightG: 60_000 }], { startedAt: at(10) })
  history(BENCH, [
    { at: at(17), reps: 8, weightG: 70_000 },
    { at: at(17, 11), reps: 5, weightG: 80_000 },
    { at: at(17, 12), kind: 'warmup', reps: 10, weightG: 200_000 },
  ])
  history(BENCH, [{ at: at(24), reps: 6, weightG: 75_000 }], { startedAt: at(24) })
  history(SQUAT, [{ at: at(24, 12), reps: 5, weightG: 120_000 }])

  const series = exerciseSeries(BENCH)
  expect(series.map((p) => p.date)).toEqual([at(10), at(17), at(24)])
  expect(series.map((p) => p.maxWeightG)).toEqual([60_000, 80_000, 75_000])
  expect(series[1].volumeG).toBe(70_000 * 8 + 80_000 * 5) // sin la entrada en calor
  expect(series[1].e1rmG).toBe(93_333) // 80 × (1 + 5/30), el mejor de la sesión
  expect(series.at(-1)?.e1rmG).toBe(90_000)

  // El límite recorta por el lado viejo y el orden sigue siendo cronológico.
  expect(exerciseSeries(BENCH, 2).map((p) => p.date)).toEqual([at(17), at(24)])
  expect(exerciseSeries(ROW)).toEqual([])
})

test('the streak counts back from this week or from the last one', () => {
  expect(streakWeeks(WED)).toBe(0)

  history(BENCH, [{ at: at(17) }], { startedAt: at(17) }) // semana pasada
  expect(streakWeeks(WED)).toBe(1)

  history(BENCH, [{ at: at(25) }], { startedAt: at(25) }) // esta
  expect(streakWeeks(WED)).toBe(2)

  history(BENCH, [{ at: at(10) }], { startedAt: at(10) }) // la anterior
  expect(streakWeeks(WED)).toBe(3)

  // Un hueco corta: la de hace cuatro semanas ya no suma.
  history(BENCH, [{ at: new Date(2026, 6, 27, 10).getTime() }], {
    startedAt: new Date(2026, 6, 27, 10).getTime(),
  })
  expect(streakWeeks(WED)).toBe(3)

  // Una sesión sin terminar no sostiene la racha.
  expect(streakWeeks(addDays(WED, 14))).toBe(0)
  history(BENCH, [{ at: addDays(WED, 14) }], { endedAt: null, startedAt: addDays(WED, 14) })
  expect(streakWeeks(addDays(WED, 14))).toBe(0)
})

test('training days bucket sessions and sets by local day', () => {
  history(BENCH, [{ at: at(24, 9) }, { at: at(24, 10) }, { at: at(24, 11), kind: 'warmup' }])
  history(SQUAT, [{ at: at(24, 20) }], { startedAt: at(24, 19) })
  history(BENCH, [{ at: at(26, 9) }], { endedAt: null, startedAt: at(26, 9) })

  const days = trainingDays(addDays(WED, -84), addDays(WED, 1))
  expect(days.map((d) => d.day)).toEqual([at(24, 0), at(26, 0)])
  expect(days[0]).toEqual({ day: at(24, 0), sessions: 2, sets: 3 })
  // La sesión en curso no cuenta como entrenamiento hecho, pero sus series sí se hicieron.
  expect(days[1]).toEqual({ day: at(26, 0), sessions: 0, sets: 1 })
})

test('muscle balance and neglect read working sets only', () => {
  history(BENCH, [
    { at: at(24), reps: 10, weightG: 60_000 },
    { at: at(24, 11), kind: 'warmup', reps: 10, weightG: 200_000 },
  ])
  history(ROW, [
    { at: at(24, 12), reps: 10, weightG: 50_000 },
    { at: at(24, 13), reps: 10, weightG: 50_000 },
  ])
  history(SQUAT, [{ at: at(15), reps: 5, weightG: 120_000 }])

  // Los últimos 7 días: de lunes 20 a hoy inclusive. La sentadilla del 15 quedó afuera.
  const from = addDays(WED, -6)
  const to = addDays(WED, 1)
  const week = volumeByMuscle(from, to)
  expect(week).toEqual([
    { muscle: 'back_lats', sets: 2, volumeG: 1_000_000 },
    { muscle: 'chest', sets: 1, volumeG: 600_000 },
  ])
  expect(pushPullBalance(from, to)).toEqual({ pull: 2, push: 1 })

  const neglected = neglectedMuscles(WED)
  expect(neglected).toHaveLength(schema.MUSCLES.length)
  const by = new Map(neglected.map((m) => [m.muscle, m.daysSince]))
  expect(by.get('chest')).toBe(2)
  expect(by.get('quads')).toBe(11)
  expect(by.get('calves')).toBeNull()
  // Lo más olvidado primero; lo que nunca se entrenó queda al final.
  expect(neglected[0].muscle).toBe('quads')
  expect(neglected.at(-1)?.daysSince).toBeNull()
})

test('deleting a session hands the records back to the sessions that survive it', () => {
  const first = createSession()
  live(first, addExercise(first, BENCH), 100_000, 5)
  const second = createSession()
  const heavy = live(second, addExercise(second, BENCH), 120_000, 5)
  expect(heavy.kinds).toEqual(['weight', 'volume', 'e1rm'])
  const third = createSession()
  live(third, addExercise(third, BENCH), 90_000, 5) // tapada por las dos anteriores

  deleteSession(second)
  expect(currentBests(BENCH).weightG).toBe(100_000)

  // Y al borrar también la de 100 kg, la de 90 —que nunca fue récord— pasa a serlo.
  deleteSession(first)
  expect(currentBests(BENCH)).toEqual({ e1rmG: 105_000, volumeG: 450_000, weightG: 90_000 })
  expect(kindsOf(BENCH)).toEqual(['e1rm', 'volume', 'weight'])
})

test('moving a session in time drags its end, its sets and its records with it', () => {
  const moved = history(
    BENCH,
    [
      { at: at(24, 10), reps: 5, weightG: 100_000 },
      { at: at(24, 11), reps: 8, weightG: 60_000 },
    ],
    { endedAt: at(24, 12), startedAt: at(24, 9) },
  )
  const completedAts = () =>
    (
      sqlite
        .query(
          `SELECT s.completed_at AS at FROM set_entry s
           JOIN session_exercise se ON se.id = s.session_exercise_id
           WHERE se.session_id = ? ORDER BY s.id`,
        )
        .all(moved) as Array<{ at: number }>
    ).map((r) => r.at)

  updateSession(moved, { startedAt: at(26, 9) })

  // Dos días más adelante: la cabecera entera y cada serie completada, por el mismo delta.
  expect(sqlite.query('SELECT started_at, ended_at FROM session WHERE id = ?').get(moved)).toEqual({
    ended_at: at(26, 12),
    started_at: at(26, 9),
  })
  expect(completedAts()).toEqual([at(26, 10), at(26, 11)])

  // El entrenamiento aparece una sola vez, y en el día nuevo: sesión y series del mismo lado.
  expect(trainingDays(addDays(WED, -84), addDays(WED, 7))).toEqual([
    { day: at(26, 0), sessions: 1, sets: 2 },
  ])
  // Y los récords se reprodujeron con los tiempos nuevos.
  expect(kindsOf(BENCH)).toEqual(['e1rm', 'volume', 'weight'])
  expect(listPrs(BENCH).every((p) => p.achievedAt === at(26, 10))).toBe(true)

  // Un patch que no toca la fecha no corre nada.
  updateSession(moved, { name: 'pecho' })
  expect(completedAts()).toEqual([at(26, 10), at(26, 11)])
})

test('removing an exercise from the session, and undoing it, keeps both sources telling the same story', () => {
  const sessionId = createSession()
  const seId = addExercise(sessionId, BENCH)
  const { setId } = live(sessionId, seId, 100_000, 5)
  const before = listPrs(BENCH).map((p) => [p.kind, p.setEntryId, p.valueG])

  const snapshot = removeSessionExercise(seId)
  expect(snapshot).not.toBeNull()
  expect(listPrs(BENCH)).toHaveLength(0)
  expect(currentBests(BENCH).weightG).toBeNull()

  if (snapshot) restoreSessionExercise(snapshot)
  // La fila vuelve con el badge puesto, así que el historial de récords tiene que volver con ella.
  expect(getSet(setId)?.isPr).toBe(true)
  expect(listPrs(BENCH).map((p) => [p.kind, p.setEntryId, p.valueG])).toEqual(before)
  expect(currentBests(BENCH).weightG).toBe(100_000)
})

test('swapping the exercise moves the sets and their records with them', () => {
  const sessionId = createSession()
  const seId = addExercise(sessionId, BENCH)
  live(sessionId, seId, 100_000, 5)
  expect(currentBests(BENCH).weightG).toBe(100_000)

  swapExercise(seId, ROW)
  expect(currentBests(BENCH)).toEqual({ e1rmG: null, volumeG: null, weightG: null })
  expect(currentBests(ROW).weightG).toBe(100_000)
  expect(kindsOf(ROW)).toEqual(['e1rm', 'volume', 'weight'])
})

test('the backfill rebuilds the cache for history logged before it existed', () => {
  // Historial escrito a mano, como el que ya está en el teléfono: series completadas, cero récords.
  history(BENCH, [
    { at: at(10), reps: 8, weightG: 60_000 },
    { at: at(10, 11), reps: 5, weightG: 80_000 },
    { at: at(10, 12), kind: 'warmup', reps: 10, weightG: 200_000 },
  ])
  history(SQUAT, [{ at: at(11), reps: 5, weightG: 120_000 }])
  expect(listPrs(BENCH)).toHaveLength(0)

  backfillPrs()
  // 80 × 5 pesa más pero mueve menos: se lleva peso y 1RM, el volumen se queda en la de 60 × 8.
  expect(kindsOf(BENCH)).toEqual(['e1rm', 'e1rm', 'volume', 'weight', 'weight'])
  expect(currentBests(BENCH)).toEqual({ e1rmG: 93_333, volumeG: 480_000, weightG: 80_000 })
  expect(currentBests(SQUAT).weightG).toBe(120_000)
  expect(listPrs(BENCH).every((p) => p.set.isPr)).toBe(true)

  // Idempotente: con el cache al día no cambia nada.
  const shape = listPrs(BENCH, 50).map((p) => [p.kind, p.setEntryId, p.valueG])
  backfillPrs()
  expect(listPrs(BENCH, 50).map((p) => [p.kind, p.setEntryId, p.valueG])).toEqual(shape)

  // Y una serie nueva se compara contra el historial, no contra el cache: 70 kg no es récord.
  const sessionId = createSession()
  expect(live(sessionId, addExercise(sessionId, BENCH), 70_000, 5).kinds).toEqual([])
})
