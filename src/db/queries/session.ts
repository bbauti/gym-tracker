import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { db } from '../client'
import { exercise, session, sessionExercise, setEntry, vWorkSet } from '../schema'
import type { Exercise } from './exercises'
import { suggestFor } from './progression'
import { recomputeExercisePrs } from './prs'
import { advanceRotation } from './routines'

// biome-ignore lint/suspicious/noExplicitAny: los parámetros del driver, que son justo lo que varía
type Db = BaseSQLiteDatabase<'sync', any, any, any>

/**
 * Los ejercicios que pierden (o recuperan) series de trabajo cuando se borra algo. Borrar arrastra
 * las filas de `personal_record` por FK cascade, pero nadie reproduce a las que quedan vivas: sin
 * esto, borrar la sesión del récord se lleva puestos los récords de las sesiones que siguen ahí.
 * Se lee ANTES del delete — después no hay de dónde sacarlo.
 */
function workedExercises(tx: Db, where: SQL): number[] {
  return tx
    .selectDistinct({ id: sessionExercise.exerciseId })
    .from(sessionExercise)
    .innerJoin(vWorkSet, eq(vWorkSet.sessionExerciseId, sessionExercise.id))
    .where(where)
    .all()
    .map((r) => r.id)
}

export type SessionRow = typeof session.$inferSelect
export type SessionExerciseRow = typeof sessionExercise.$inferSelect
export type SetRow = typeof setEntry.$inferSelect

/** Everything the session screen renders, in one shape. Exercises by `orderIndex`, sets by theirs. */
export type SessionTree = {
  session: SessionRow
  exercises: Array<{ se: SessionExerciseRow; exercise: Exercise; sets: SetRow[] }>
}

/** The workout in progress, if any. Newest wins: there should only ever be one. */
export function getActiveSessionId(): number | null {
  const row = db
    .select({ id: session.id })
    .from(session)
    .where(isNull(session.endedAt))
    .orderBy(desc(session.startedAt), desc(session.id))
    .limit(1)
    .get()
  return row?.id ?? null
}

export function createSession(input?: { name?: string | null; startedAt?: number }): number {
  return db
    .insert(session)
    .values({ name: input?.name ?? null, startedAt: input?.startedAt ?? Date.now() })
    .returning({ id: session.id })
    .get().id
}

export function getSession(id: number): SessionRow | null {
  return db.select().from(session).where(eq(session.id, id)).get() ?? null
}

export function getSessionExercise(seId: number): SessionExerciseRow | null {
  return db.select().from(sessionExercise).where(eq(sessionExercise.id, seId)).get() ?? null
}

/** Three round trips (session · exercises · sets), never one per row. */
export function getSessionTree(id: number): SessionTree | null {
  const row = getSession(id)
  if (!row) return null

  const rows = db
    .select()
    .from(sessionExercise)
    .innerJoin(exercise, eq(exercise.id, sessionExercise.exerciseId))
    .where(eq(sessionExercise.sessionId, id))
    .orderBy(asc(sessionExercise.orderIndex), asc(sessionExercise.id))
    .all()

  const seIds = rows.map((r) => r.session_exercise.id)
  const sets =
    seIds.length === 0
      ? []
      : db
          .select()
          .from(setEntry)
          .where(inArray(setEntry.sessionExerciseId, seIds))
          .orderBy(asc(setEntry.orderIndex), asc(setEntry.id))
          .all()

  const bySe = new Map<number, SetRow[]>()
  for (const s of sets) {
    const list = bySe.get(s.sessionExerciseId)
    if (list) list.push(s)
    else bySe.set(s.sessionExerciseId, [s])
  }

  return {
    session: row,
    exercises: rows.map((r) => ({
      se: r.session_exercise,
      exercise: r.exercise,
      sets: bySe.get(r.session_exercise.id) ?? [],
    })),
  }
}

/**
 * Appends the exercise plus one empty set: an exercise with no rows to type into is useless.
 *
 * La serie nace con el peso sugerido puesto como fantasma (E01–E09) y el porqué en la fila del
 * ejercicio. Sugerido, no aplicado: `weight_g` sigue vacío hasta que el usuario tilde (§2.2). El
 * historial excluye esta sesión — sugerir a partir de lo que se está anotando ahora sería la app
 * persiguiéndose la cola.
 */
export function addExercise(sessionId: number, exerciseId: number): number {
  return db.transaction((tx) => {
    const next = tx
      .select({ n: sql<number>`coalesce(max(${sessionExercise.orderIndex}) + 1, 0)` })
      .from(sessionExercise)
      .where(eq(sessionExercise.sessionId, sessionId))
      .get()

    const suggestion = suggestFor(tx, exerciseId, { excludeSessionId: sessionId })

    const seId = tx
      .insert(sessionExercise)
      .values({
        sessionId,
        exerciseId,
        orderIndex: next?.n ?? 0,
        suggestedReason: suggestion.reason,
      })
      .returning({ id: sessionExercise.id })
      .get().id

    tx.insert(setEntry)
      .values({
        sessionExerciseId: seId,
        orderIndex: 0,
        kind: 'normal',
        suggestedWeightG: suggestion.weightG,
        suggestedReps: suggestion.reps,
      })
      .run()
    return seId
  })
}

export type SessionExerciseSnapshot = { se: SessionExerciseRow; sets: SetRow[] }

/**
 * Its sets go with it (FK cascade), so removing is destructive and asks nothing: the snapshot it
 * returns is what the undo toast needs to put the card back with everything that was logged in it.
 */
export function removeSessionExercise(seId: number): SessionExerciseSnapshot | null {
  return db.transaction((tx) => {
    const se = tx.select().from(sessionExercise).where(eq(sessionExercise.id, seId)).get()
    if (!se) return null
    const sets = tx
      .select()
      .from(setEntry)
      .where(eq(setEntry.sessionExerciseId, seId))
      .orderBy(asc(setEntry.orderIndex), asc(setEntry.id))
      .all()
    const worked = workedExercises(tx, eq(sessionExercise.id, seId))
    tx.delete(sessionExercise).where(eq(sessionExercise.id, seId)).run()
    // Igual que `deleteSet`: los récords de las series que se fueron ya no existen, y los que
    // tapaban vuelven a valer.
    for (const exerciseId of worked) recomputeExercisePrs(exerciseId, tx)
    return { se, sets }
  })
}

/** Same ids and same orderIndex, sets included: undo puts the card back where it was. */
export function restoreSessionExercise(snapshot: SessionExerciseSnapshot): void {
  db.transaction((tx) => {
    // Same as restoreSet: undo can outlive the session it belongs to (deleted from history), and
    // the FK insert would throw inside the toast's onPress.
    const row = tx
      .select({ id: session.id })
      .from(session)
      .where(eq(session.id, snapshot.se.sessionId))
      .get()
    if (!row) return
    tx.insert(sessionExercise).values(snapshot.se).run()
    if (snapshot.sets.length > 0) tx.insert(setEntry).values(snapshot.sets).run()
    // Las filas vuelven con el `is_pr` que tenían; los récords, no (se fueron con el borrado). El
    // replay es lo único que deja de acuerdo a las dos fuentes: la serie con badge y el historial.
    if (snapshot.sets.some((s) => s.completedAt !== null && s.kind !== 'warmup'))
      recomputeExercisePrs(snapshot.se.exerciseId, tx)
  })
}

/** One transaction, so the list never renders half-reordered. Ids from another session are ignored. */
export function reorderExercises(sessionId: number, orderedSeIds: number[]): void {
  db.transaction((tx) => {
    orderedSeIds.forEach((seId, index) => {
      tx.update(sessionExercise)
        .set({ orderIndex: index })
        .where(and(eq(sessionExercise.id, seId), eq(sessionExercise.sessionId, sessionId)))
        .run()
    })
  })
}

/** Keeps the sets: swapping is "I did this on the other machine", not "start over". */
export function swapExercise(seId: number, exerciseId: number): void {
  db.transaction((tx) => {
    const se = tx.select().from(sessionExercise).where(eq(sessionExercise.id, seId)).get()
    if (!se || se.exerciseId === exerciseId) return
    // Las series completadas se mudan de ejercicio, y sus récords con ellas: hay que reproducir los
    // dos lados, el que las pierde y el que las hereda.
    const worked = workedExercises(tx, eq(sessionExercise.id, seId))
    tx.update(sessionExercise).set({ exerciseId }).where(eq(sessionExercise.id, seId)).run()
    if (worked.length === 0) return
    for (const id of [se.exerciseId, exerciseId]) recomputeExercisePrs(id, tx)
  })
}

export function updateSessionExercise(seId: number, patch: { note?: string | null }): void {
  if (Object.keys(patch).length === 0) return
  db.update(sessionExercise).set(patch).where(eq(sessionExercise.id, seId)).run()
}

/**
 * Mover la fecha mueve el entrenamiento **entero**. Las estadísticas cuentan las sesiones por
 * `session.started_at` y las series por `v_work_set.completed_at`: correr solo la cabecera parte el
 * mismo entrenamiento en dos días (o dos semanas), y el replay de récords —que ordena por
 * `(completed_at, id)`— cambia de resultado. `ended_at` va con ellos: es la duración del historial.
 *
 * `paused_at` y `rest_ends_at` NO se corren: son relojes de una sesión en curso contra `Date.now()`,
 * no marcas de cuándo pasó el entrenamiento.
 */
export function updateSession(
  id: number,
  patch: Partial<
    Pick<
      SessionRow,
      'name' | 'note' | 'startedAt' | 'endedAt' | 'pausedMs' | 'pausedAt' | 'restEndsAt'
    >
  >,
): void {
  if (Object.keys(patch).length === 0) return
  db.transaction((tx) => {
    const row = tx.select().from(session).where(eq(session.id, id)).get()
    if (!row) return
    const delta = patch.startedAt === undefined ? 0 : patch.startedAt - row.startedAt

    // El que escribe `ended_at` a mano manda: acá solo se lo arrastra si nadie lo tocó.
    const endedAt =
      delta !== 0 && patch.endedAt === undefined && row.endedAt !== null
        ? row.endedAt + delta
        : undefined
    tx.update(session)
      .set(endedAt === undefined ? patch : { ...patch, endedAt })
      .where(eq(session.id, id))
      .run()
    if (delta === 0) return

    tx.update(setEntry)
      .set({ completedAt: sql`${setEntry.completedAt} + ${delta}` })
      .where(
        and(
          isNotNull(setEntry.completedAt),
          inArray(
            setEntry.sessionExerciseId,
            tx
              .select({ id: sessionExercise.id })
              .from(sessionExercise)
              .where(eq(sessionExercise.sessionId, id)),
          ),
        ),
      )
      .run()

    // El historial se reproduce en otro orden: un récord de esta sesión puede quedar tapado por otra
    // —o destaparla— según a qué día se la mueva.
    for (const exerciseId of workedExercises(tx, eq(sessionExercise.sessionId, id)))
      recomputeExercisePrs(exerciseId, tx)
  })
}

/**
 * El descanso se guarda como "cuándo termina", no como "cuánto falta": la cuenta la deriva la
 * pantalla de `Date.now()` y nadie tiene que correr nada mientras el teléfono está bloqueado
 * (plan §2.6). Programar/cancelar la notificación es del que llama (`@/notifications`): esta capa
 * no conoce expo.
 */
export function setRestEndsAt(id: number, endsAt: number): void {
  db.update(session).set({ restEndsAt: endsAt }).where(eq(session.id, id)).run()
}

/** Saltar, llegar a cero o terminar: el descanso deja de existir, no queda en 0. */
export function clearRest(id: number): void {
  db.update(session).set({ restEndsAt: null }).where(eq(session.id, id)).run()
}

/**
 * Cuándo arrancó el descanso en curso: el último set completado de la sesión. Derivable, así que no
 * hay una columna `rest_started_at` que mantener sincronizada — la barra de progreso necesita el
 * largo total y esto se lo da.
 */
export function lastCompletedAt(sessionId: number): number | null {
  const row = db
    .select({ at: sql<number | null>`max(${setEntry.completedAt})` })
    .from(setEntry)
    .innerJoin(sessionExercise, eq(sessionExercise.id, setEntry.sessionExerciseId))
    .where(eq(sessionExercise.sessionId, sessionId))
    .get()
  return row?.at ?? null
}

/**
 * Pausa abierta. `isNull` en el where: pausar dos veces (dos taps, dos pantallas) no puede pisar el
 * `pausedAt` original y regalar el tiempo transcurrido.
 *
 * El que llama cancela la notificación de descanso: mientras la sesión está en pausa el descanso
 * también lo está, y una notificación programada al `restEndsAt` viejo sonaría antes de tiempo.
 */
export function pauseSession(id: number): void {
  db.update(session)
    .set({ pausedAt: Date.now() })
    .where(and(eq(session.id, id), isNull(session.pausedAt)))
    .run()
}

/**
 * Cierra la pausa: lo que duró se acumula en `pausedMs` y `pausedAt` vuelve a null.
 *
 * ponytail: la pausa **corre el `restEndsAt` hacia adelante** por lo que duró, que es la regla
 * correcta más barata para "el descanso también se congela" — un campo menos y el countdown sigue
 * siendo una resta. Techo: durante la pausa el `restEndsAt` guardado miente (apunta al final que
 * habría tenido sin pausar), así que la UI no debe dibujar el descanso mientras `pausedAt !== null`
 * y el que llama tiene que reprogramar la notificación con el `restEndsAt` nuevo al reanudar.
 * Upgrade: guardar el descanso como "restaban N ms" al pausar.
 */
export function resumeSession(id: number): void {
  db.transaction((tx) => {
    const row = tx.select().from(session).where(eq(session.id, id)).get()
    if (!row || row.pausedAt === null) return
    const paused = Math.max(0, Date.now() - row.pausedAt)
    // Solo se corre el descanso que seguía vivo al pausar. Uno ya vencido (se terminó con la
    // pantalla desmontada, o `restSec` era 0) se limpia: correrlo lo resucitaría en el futuro y
    // aparecería una barra de descanso salida de la nada, con notificación incluida.
    const rest = row.restEndsAt !== null && row.restEndsAt > row.pausedAt ? row.restEndsAt : null
    tx.update(session)
      .set({
        pausedMs: row.pausedMs + paused,
        pausedAt: null,
        restEndsAt: rest === null ? null : rest + paused,
      })
      .where(eq(session.id, id))
      .run()
  })
}

/**
 * Closes the workout and sweeps the scaffolding: the empty set every exercise is born with, and the
 * exercises that end up with none. A set the user typed into but never ticked survives — it is data.
 *
 * Si la sesión salió de un día de rutina, terminarla también corre la rotación (D10) — en esta misma
 * transacción, así no existe el estado "terminada pero sin rotar".
 */
export function endSession(id: number): void {
  db.transaction((tx) => {
    // Terminar dos veces (dos toques que pasan el diálogo, la misma sesión terminada desde otra
    // pantalla) volvería a estampar `ended_at` —cambiando la duración del historial— y rotaría la
    // rutina un día de más. Terminada es terminada.
    const row = tx.select().from(session).where(eq(session.id, id)).get()
    if (!row || row.endedAt !== null) return

    const seIds = tx
      .select({ id: sessionExercise.id })
      .from(sessionExercise)
      .where(eq(sessionExercise.sessionId, id))
      .all()
      .map((r) => r.id)

    if (seIds.length > 0) {
      tx.delete(setEntry)
        .where(
          and(
            inArray(setEntry.sessionExerciseId, seIds),
            isNull(setEntry.completedAt),
            isNull(setEntry.weightG),
            isNull(setEntry.reps),
            isNull(setEntry.durationMs),
            isNull(setEntry.distanceMm),
          ),
        )
        .run()

      tx.delete(sessionExercise)
        .where(
          and(
            eq(sessionExercise.sessionId, id),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(setEntry)
                .where(eq(setEntry.sessionExerciseId, sessionExercise.id)),
            ),
          ),
        )
        .run()
    }

    // Terminar con la sesión en pausa cierra la pausa: si no, `pausedAt` queda abierto para siempre
    // y la duración del historial descontaría hasta el infinito.
    const now = Date.now()
    tx.update(session)
      .set({
        endedAt: now,
        restEndsAt: null,
        pausedAt: null,
        pausedMs: row.pausedMs + (row.pausedAt === null ? 0 : Math.max(0, now - row.pausedAt)),
      })
      .where(eq(session.id, id))
      .run()

    advanceRotation(id, tx)
  })
}

/** Exercises and sets go with it (FK cascade), y con ellas los récords que dieron. */
export function deleteSession(id: number): void {
  db.transaction((tx) => {
    const worked = workedExercises(tx, eq(sessionExercise.sessionId, id))
    tx.delete(session).where(eq(session.id, id)).run()
    for (const exerciseId of worked) recomputeExercisePrs(exerciseId, tx)
  })
}
