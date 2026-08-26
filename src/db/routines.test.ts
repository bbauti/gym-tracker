import { Database } from 'bun:sqlite'
import { beforeEach, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'

/**
 * bun:sqlite haciendo de expo-sqlite: los dos hablan el mismo driver síncrono, así que alcanza con
 * replayar las migraciones y darle a `queries/routines.ts` este `db` en vez del de `client.ts` (que
 * al importarse arrastraría expo-modules-core y react-native).
 */
const sqlite = new Database(':memory:')
sqlite.exec('PRAGMA foreign_keys = ON')
for (const file of [
  '0000_init.sql',
  '0001_fts.sql',
  '0002_session_paused_at.sql',
  '0003_set_targets.sql',
  '0004_session_rest.sql',
]) {
  const sql = readFileSync(join(import.meta.dir, 'migrations', file), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) sqlite.exec(statement)
  }
}
const db = drizzle(sqlite, { schema })
mock.module('./client', () => ({ db, ready: Promise.resolve(), sqlite }))

// Dinámico a propósito: los `import` estáticos se izan por encima del `mock.module` de arriba.
const {
  addDay,
  addRoutineExercise,
  advanceRotation,
  createRoutine,
  deleteDay,
  deleteRoutineSet,
  duplicateRoutine,
  estimatedDurationMs,
  getRoutineTree,
  lastWeightG,
  listRoutines,
  removeRoutineExercise,
  restoreRoutineExercise,
  restoreRoutineSet,
  startSessionFromDay,
  updateDay,
  updateRoutineExercise,
  updateRoutineSet,
} = await import('./queries/routines')
const { endSession, getSessionTree } = await import('./queries/session')

const BENCH = 1
const SQUAT = 2

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM set_entry;
    DELETE FROM session_exercise;
    DELETE FROM session;
    DELETE FROM routine_set;
    DELETE FROM routine_exercise;
    DELETE FROM routine_day;
    DELETE FROM routine;
    DELETE FROM exercise;
    DELETE FROM sqlite_sequence;
    INSERT INTO exercise (id, name_es, name_en, primary_muscle, equipment, metric)
    VALUES (${BENCH}, 'Press banca', 'Bench press', 'chest', 'barbell', 'weight_reps'),
           (${SQUAT}, 'Sentadilla', 'Squat', 'quads', 'barbell', 'weight_reps');
  `)
})

/** Una sesión vieja ya terminada, con una serie completada por cada peso. */
function history(
  exerciseId: number,
  sets: Array<{ weightG: number; kind?: string; at: number }>,
  span?: { startedAt: number; endedAt: number; pausedMs?: number; dayId?: number },
): void {
  const started = span?.startedAt ?? sets[0].at
  const sessionId = Number(
    (
      sqlite
        .query(
          `INSERT INTO session (routine_day_id, name, started_at, ended_at, paused_ms)
           VALUES (?, 'vieja', ?, ?, ?) RETURNING id`,
        )
        .get(
          span?.dayId ?? null,
          started,
          span?.endedAt ?? sets[sets.length - 1].at,
          span?.pausedMs ?? 0,
        ) as { id: number }
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
         VALUES (?, ?, ?, ?, 8, ?)`,
      )
      .run(seId, i, s.kind ?? 'normal', s.weightG, s.at)
  })
}

const dayIds = (routineId: number) =>
  (
    sqlite
      .query('SELECT id FROM routine_day WHERE routine_id = ? ORDER BY order_index, id')
      .all(routineId) as { id: number }[]
  ).map((r) => r.id)

const currentIndex = (routineId: number) =>
  (
    sqlite.query('SELECT current_day_index AS i FROM routine WHERE id = ?').get(routineId) as {
      i: number
    }
  ).i

test('starting a day preloads real uncompleted rows with targets and a suggested weight', () => {
  const routineId = createRoutine('PPL', 'Empuje')
  const [dayId] = dayIds(routineId)
  const reId = addRoutineExercise(dayId, BENCH)
  const tree = getRoutineTree(routineId)
  const sets = tree?.days[0].exercises[0].sets ?? []
  expect(sets).toHaveLength(3)
  // La primera pasa a ser una de 5: el rango objetivo se copia por serie, no por ejercicio.
  updateRoutineSet(sets[0].id, { repsMin: 5, repsMax: 5 })
  expect(reId).toBe(tree?.days[0].exercises[0].re.id ?? -1)

  // La sugerencia sale del último peso de TRABAJO: la entrada en calor de 100 kg es más nueva y no
  // se ofrece (v_work_set), y la de 60 kg es más vieja que la de 62,5.
  history(BENCH, [
    { at: 1_000, weightG: 60_000 },
    { at: 2_000, weightG: 62_500 },
    { at: 3_000, kind: 'warmup', weightG: 100_000 },
  ])
  expect(lastWeightG(BENCH)).toBe(62_500)
  expect(lastWeightG(SQUAT)).toBeNull()

  const sessionId = startSessionFromDay(dayId)
  const session = getSessionTree(sessionId)
  expect(session?.session.name).toBe('Empuje')
  expect(session?.session.routineDayId).toBe(dayId)
  expect(session?.exercises).toHaveLength(1)

  const rows = session?.exercises[0].sets ?? []
  expect(rows).toHaveLength(3)
  expect(rows.map((r) => [r.targetRepsMin, r.targetRepsMax])).toEqual([
    [5, 5],
    [8, 12],
    [8, 12],
  ])
  // Sugerido, no aplicado: `weight_g` sigue vacío y la serie sin completar (§2.2).
  expect(rows.every((r) => r.completedAt === null && r.weightG === null)).toBe(true)
  expect(rows.map((r) => r.suggestedWeightG)).toEqual([62_500, 62_500, 62_500])
  expect(rows.map((r) => r.orderIndex)).toEqual([0, 1, 2])
})

test('an exercise left without target sets still gets a row to type into', () => {
  const routineId = createRoutine('Fuerza', 'A')
  const [dayId] = dayIds(routineId)
  addRoutineExercise(dayId, SQUAT)
  for (const s of getRoutineTree(routineId)?.days[0].exercises[0].sets ?? []) {
    deleteRoutineSet(s.id)
  }

  const session = getSessionTree(startSessionFromDay(dayId))
  expect(session?.exercises[0].sets).toHaveLength(1)
  expect(session?.exercises[0].sets[0].targetRepsMin).toBeNull()
})

test('finishing a workout rotates to the next day and wraps around', () => {
  const routineId = createRoutine('Full body', 'A')
  addDay(routineId, 'B')
  addDay(routineId, 'C')
  const days = dayIds(routineId)
  expect(days).toHaveLength(3)

  for (const [at, expected] of [
    [0, 1],
    [1, 2],
    [2, 0],
  ] as const) {
    expect(listRoutines()[0].nextDay?.id).toBe(days[at])
    endSession(startSessionFromDay(days[at]))
    expect(currentIndex(routineId)).toBe(expected)
  }

  // Terminar un entrenamiento libre (sin día) no toca la rotación.
  const free = Number(
    (
      sqlite
        .query("INSERT INTO session (name, started_at) VALUES ('libre', 1) RETURNING id")
        .get() as { id: number }
    ).id,
  )
  endSession(free)
  expect(currentIndex(routineId)).toBe(0)
})

test('advanceRotation ignores a day that no longer belongs to the routine', () => {
  const routineId = createRoutine('Torso', 'A')
  const [dayId] = dayIds(routineId)
  const sessionId = startSessionFromDay(dayId)
  deleteDay(dayId)

  // El FK es `set null`: la sesión sobrevive sin día y rotar no puede inventar uno.
  expect(() => advanceRotation(sessionId)).not.toThrow()
  expect(currentIndex(routineId)).toBe(0)
})

test('deleting a day clamps the rotation instead of pointing past the end', () => {
  const routineId = createRoutine('Arnold', 'A')
  addDay(routineId, 'B')
  addDay(routineId, 'C')
  const days = dayIds(routineId)

  endSession(startSessionFromDay(days[1]))
  expect(currentIndex(routineId)).toBe(2)

  deleteDay(days[2])
  expect(currentIndex(routineId)).toBe(1)

  deleteDay(days[1])
  expect(currentIndex(routineId)).toBe(0)

  deleteDay(days[0])
  expect(currentIndex(routineId)).toBe(0)
  expect(listRoutines()[0].nextDay).toBeNull()
})

test('duplicating copies the whole tree and leaves the original alone', () => {
  const routineId = createRoutine('Original', 'A')
  addDay(routineId, 'B')
  const [dayA, dayB] = dayIds(routineId)
  updateDay(dayB, { isDeload: true })
  const reId = addRoutineExercise(dayA, BENCH)
  addRoutineExercise(dayB, SQUAT)
  const first = getRoutineTree(routineId)?.days[0].exercises[0].sets[0]
  if (first) updateRoutineSet(first.id, { kind: 'amrap', repsMax: 6, repsMin: 3, targetRpe: 8.5 })
  endSession(startSessionFromDay(dayA))

  const copyId = duplicateRoutine(routineId, 'Original (copia)')
  const source = getRoutineTree(routineId)
  const copy = getRoutineTree(copyId)

  expect(copy?.routine.name).toBe('Original (copia)')
  // La copia arranca la rotación de cero aunque la original ya iba por el día B.
  expect(source?.routine.currentDayIndex).toBe(1)
  expect(copy?.routine.currentDayIndex).toBe(0)

  const shape = (tree: typeof copy) =>
    tree?.days.map((d) => ({
      isDeload: d.day.isDeload,
      name: d.day.name,
      exercises: d.exercises.map((e) => ({
        exerciseId: e.re.exerciseId,
        sets: e.sets.map((s) => [s.kind, s.repsMin, s.repsMax, s.targetRpe]),
      })),
    }))
  expect(shape(copy)).toEqual(shape(source))

  // Filas nuevas, no las mismas: editar la copia no toca la original.
  const copiedRe = copy?.days[0].exercises[0].re.id ?? -1
  expect(copiedRe).not.toBe(reId)
  deleteRoutineSet(copy?.days[0].exercises[0].sets[0].id ?? -1)
  expect(getRoutineTree(routineId)?.days[0].exercises[0].sets).toHaveLength(3)
  expect(getRoutineTree(copyId)?.days[0].exercises[0].sets).toHaveLength(2)
})

test('the summary counts the day that is up next and estimates it from finished sessions', () => {
  const routineId = createRoutine('Semanal', 'Pierna')
  const [dayId] = dayIds(routineId)
  addRoutineExercise(dayId, SQUAT)
  addRoutineExercise(dayId, BENCH)

  expect(estimatedDurationMs(dayId)).toBeNull()
  // 60 min de reloj menos 10 de pausa, y 40 limpios: promedio 45.
  history(SQUAT, [{ at: 10, weightG: 100_000 }], {
    dayId,
    endedAt: 3_600_000,
    pausedMs: 600_000,
    startedAt: 0,
  })
  history(SQUAT, [{ at: 20, weightG: 100_000 }], { dayId, endedAt: 2_400_000, startedAt: 0 })
  expect(estimatedDurationMs(dayId)).toBe(45 * 60_000)

  const [summary] = listRoutines()
  expect(summary.dayCount).toBe(1)
  expect(summary.nextDay?.exerciseCount).toBe(2)
  expect(summary.nextDay?.setCount).toBe(6)
  expect(summary.lastDoneAt).toBe(3_600_000)
  expect(summary.estimatedMs).toBe(45 * 60_000)
})

test('the rest the routine asks for travels with the row, not with the routine', () => {
  const routineId = createRoutine('Fuerza', 'A')
  const [dayId] = dayIds(routineId)
  const reId = addRoutineExercise(dayId, SQUAT)
  addRoutineExercise(dayId, BENCH)
  updateRoutineExercise(reId, { restSec: 180 })

  const session = getSessionTree(startSessionFromDay(dayId))
  // El de la rutina viaja copiado; el que no pide nada queda en null (= el del ejercicio o ajustes).
  expect(session?.exercises.map((e) => e.se.restSec)).toEqual([180, null])

  // Editar la rutina después no cambia el descanso del entrenamiento que ya arrancó.
  updateRoutineExercise(reId, { restSec: 60 })
  expect(getSessionTree(session?.session.id ?? 0)?.exercises[0].se.restSec).toBe(180)
})

test('finishing an already finished workout does not rotate again', () => {
  const routineId = createRoutine('Full body', 'A')
  addDay(routineId, 'B')
  const [dayA] = dayIds(routineId)

  const sessionId = startSessionFromDay(dayA)
  endSession(sessionId)
  const endedAt = getSessionTree(sessionId)?.session.endedAt ?? 0
  expect(currentIndex(routineId)).toBe(1)

  endSession(sessionId)
  expect(currentIndex(routineId)).toBe(1)
  expect(getSessionTree(sessionId)?.session.endedAt).toBe(endedAt)
})

test('deleting a day before the one that is up next does not skip it', () => {
  const routineId = createRoutine('Arnold', 'A')
  addDay(routineId, 'B')
  addDay(routineId, 'C')
  const [dayA, dayB] = dayIds(routineId)

  endSession(startSessionFromDay(dayA))
  expect(listRoutines()[0].nextDay?.id).toBe(dayB)

  // `current_day_index` es una posición: borrar A corre a B una casilla para atrás.
  deleteDay(dayA)
  expect(listRoutines()[0].nextDay?.id).toBe(dayB)
  expect(currentIndex(routineId)).toBe(0)
})

test('undo is a no-op once the row it belonged to is gone', () => {
  const routineId = createRoutine('PPL', 'Empuje')
  const [dayId] = dayIds(routineId)
  const reId = addRoutineExercise(dayId, BENCH)
  const set = deleteRoutineSet(getRoutineTree(routineId)?.days[0].exercises[0].sets[0].id ?? -1)
  const removed = removeRoutineExercise(reId)

  // El toast sobrevive a navegar: para cuando se toca "Deshacer" el padre puede no estar.
  expect(() => restoreRoutineSet(set)).not.toThrow()
  expect(getRoutineTree(routineId)?.days[0].exercises).toHaveLength(0)

  // El ejercicio sí vuelve (su día sigue ahí), con las series que le quedaban.
  if (removed) restoreRoutineExercise(removed)
  expect(getRoutineTree(routineId)?.days[0].exercises[0].sets).toHaveLength(2)

  const again = removeRoutineExercise(reId)
  deleteDay(dayId)
  if (again) expect(() => restoreRoutineExercise(again)).not.toThrow()
  expect(getRoutineTree(routineId)?.days).toHaveLength(0)
})

test('a session that lasted seconds does not drag the estimate to zero', () => {
  const routineId = createRoutine('Semanal', 'Pierna')
  const [dayId] = dayIds(routineId)

  // Empezar sin querer y terminar: 30 s que redondeaban a "~0:00" en la card.
  history(SQUAT, [{ at: 10, weightG: 100_000 }], { dayId, endedAt: 30_000, startedAt: 0 })
  expect(estimatedDurationMs(dayId)).toBeNull()
  expect(listRoutines()[0].estimatedMs).toBeNull()

  history(SQUAT, [{ at: 20, weightG: 100_000 }], { dayId, endedAt: 40 * 60_000, startedAt: 0 })
  expect(estimatedDurationMs(dayId)).toBe(40 * 60_000)
})
