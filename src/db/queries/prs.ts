import { and, asc, desc, eq, getTableColumns, inArray, lt, notExists, or, sql } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { absorb, detectPrs, e1rmG, emptyBests, type PrKind, type SetFacts } from '@/lib/prs'
import { db } from '../client'
import { personalRecord, sessionExercise, setEntry, settings, vWorkSet } from '../schema'
import type { SetRow } from './session'

/** Igual que en `routines.ts`: expo-sqlite, bun:sqlite y una transacción son el mismo driver sync. */
// biome-ignore lint/suspicious/noExplicitAny: los parámetros del driver, que son justo lo que varía
type Db = BaseSQLiteDatabase<'sync', any, any, any>

export type PersonalRecordRow = typeof personalRecord.$inferSelect

/**
 * `personal_record` es un **cache reconstruible** (plan §3): la verdad son las series completadas, y
 * cada fila de acá se puede volver a derivar de `v_work_set` con `recomputeExercisePrs`. Por eso
 * borrar, destildar o editar una serie no "arregla" filas a mano — reproduce el ejercicio entero.
 */

type Facts = SetFacts & { id: number; exerciseId: number; completedAt: number }

/** La serie y el ejercicio al que pertenece: un lookup por pk más el join indexado. */
function factsOf(on: Db, setId: number): Facts | null {
  const row = on
    .select({
      completedAt: setEntry.completedAt,
      exerciseId: sessionExercise.exerciseId,
      id: setEntry.id,
      kind: setEntry.kind,
      reps: setEntry.reps,
      weightG: setEntry.weightG,
    })
    .from(setEntry)
    .innerJoin(sessionExercise, eq(sessionExercise.id, setEntry.sessionExerciseId))
    .where(eq(setEntry.id, setId))
    .get()
  return row && row.completedAt !== null ? { ...row, completedAt: row.completedAt } : null
}

/** Trampa #4: la fórmula sale de ajustes, nunca de una constante acá. */
function formulaOf(on: Db): string {
  const row = on.select({ f: settings.e1rmFormula }).from(settings).where(eq(settings.id, 1)).get()
  if (!row) throw new Error('settings row missing: seed() did not run before this read')
  return row.f
}

/**
 * De qué ejercicio es una serie y si está completada, en una query. Lo que `sets.ts` necesita saber
 * para decidir si un write mueve el historial de récords.
 */
export function setOwner(
  on: Db,
  setId: number,
): { exerciseId: number; completedAt: number | null } | null {
  return (
    on
      .select({ completedAt: setEntry.completedAt, exerciseId: sessionExercise.exerciseId })
      .from(setEntry)
      .innerJoin(sessionExercise, eq(sessionExercise.id, setEntry.sessionExerciseId))
      .where(eq(setEntry.id, setId))
      .get() ?? null
  )
}

/**
 * Lo que se hizo ANTES: `(completed_at, id)` es el orden en el que se reproduce el historial, así que
 * "antes" se pregunta con ese mismo par. Sin el desempate por id, dos series completadas en el mismo
 * milisegundo se contarían mutuamente como previas y el récord dependería del orden de las filas.
 */
function before(at: number, setId: number) {
  return or(lt(vWorkSet.completedAt, at), and(eq(vWorkSet.completedAt, at), lt(vWorkSet.id, setId)))
}

function prRows(set: Facts, kinds: PrKind[], formula: string) {
  const weightG = set.weightG ?? 0
  const reps = set.reps as number
  return kinds.map((kind) => ({
    achievedAt: set.completedAt,
    exerciseId: set.exerciseId,
    kind,
    // El peso queda en `value_g` también para `reps_at_weight`: "12 reps" sin decir a cuánto no es
    // un récord, es un número suelto.
    reps: kind === 'reps_at_weight' ? reps : null,
    setEntryId: set.id,
    valueG:
      kind === 'volume'
        ? weightG * reps
        : kind === 'e1rm'
          ? e1rmG(weightG, reps, formula)
          : weightG,
  }))
}

/**
 * H01–H05, dentro de la transacción de `completeSet`: una query indexada (las series de trabajo
 * previas del ejercicio), la comparación en memoria y, solo si hay récord, dos writes. La fila sale
 * con `is_pr` puesto en el mismo snapshot que la tilda — el badge aparece sin event bus.
 */
export function recordPrs(tx: Db, setId: number): PrKind[] {
  const set = factsOf(tx, setId)
  if (!set) return []

  const formula = formulaOf(tx)
  const prior = tx
    .select({ kind: vWorkSet.kind, reps: vWorkSet.reps, weightG: vWorkSet.weightG })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .where(and(eq(sessionExercise.exerciseId, set.exerciseId), before(set.completedAt, setId)))
    .all()

  const best = emptyBests()
  for (const s of prior) absorb(best, s, formula)
  const kinds = detectPrs(set, best, formula)
  if (kinds.length === 0) return []

  tx.insert(personalRecord)
    .values(prRows(set, kinds, formula))
    .run()
  tx.update(setEntry).set({ isPr: true }).where(eq(setEntry.id, setId)).run()
  return kinds
}

/**
 * Reconstruye el cache del ejercicio entero: borra sus récords y reproduce sus series de trabajo en
 * orden. Se llama después de borrar, destildar o editar una serie completada — un récord viejo puede
 * haber tapado el de la serie siguiente, así que no alcanza con borrar las filas de la que cambió.
 *
 * `on` para correr dentro de la transacción del que llama: abrir una anidada sobre la misma conexión
 * es un error de SQLite (mismo motivo que `advanceRotation`).
 */
export function recomputeExercisePrs(exerciseId: number, on: Db = db): void {
  if (on === db) {
    db.transaction((tx) => replay(tx, exerciseId))
    return
  }
  replay(on, exerciseId)
}

function replay(tx: Db, exerciseId: number): void {
  const sets = tx
    .select({
      completedAt: vWorkSet.completedAt,
      exerciseId: sessionExercise.exerciseId,
      id: vWorkSet.id,
      kind: vWorkSet.kind,
      reps: vWorkSet.reps,
      weightG: vWorkSet.weightG,
    })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .where(eq(sessionExercise.exerciseId, exerciseId))
    .orderBy(asc(vWorkSet.completedAt), asc(vWorkSet.id))
    .all()

  tx.delete(personalRecord).where(eq(personalRecord.exerciseId, exerciseId)).run()
  // Todas las series del ejercicio, no solo las de trabajo: una serie que pasó a entrada en calor (o
  // que se destildó) se quedaría con el badge puesto para siempre. `isPr = true` acota el barrido a
  // las pocas filas que pueden cambiar — sin eso, cada edición reescribe el historial entero del
  // ejercicio y despierta a todos los `useQuery` de `set_entry`.
  tx.update(setEntry)
    .set({ isPr: false })
    .where(
      and(
        eq(setEntry.isPr, true),
        inArray(
          setEntry.sessionExerciseId,
          tx
            .select({ id: sessionExercise.id })
            .from(sessionExercise)
            .where(eq(sessionExercise.exerciseId, exerciseId)),
        ),
      ),
    )
    .run()

  const formula = formulaOf(tx)
  const best = emptyBests()
  const rows: ReturnType<typeof prRows> = []
  const winners: number[] = []
  for (const set of sets) {
    if (set.completedAt === null) continue // imposible en la view; el tipo no lo sabe
    const kinds = detectPrs(set, best, formula)
    if (kinds.length > 0) {
      rows.push(...prRows({ ...set, completedAt: set.completedAt }, kinds, formula))
      winners.push(set.id)
    }
    absorb(best, set, formula)
  }

  if (rows.length > 0) tx.insert(personalRecord).values(rows).run()
  if (winners.length > 0)
    tx.update(setEntry).set({ isPr: true }).where(inArray(setEntry.id, winners)).run()
}

/**
 * El cache no existía antes de esta fase: todo lo que se logueó en las fases 2–4 (y todo lo que
 * vuelva de un backup viejo) tiene series completadas y cero récords, así que "Récords" y las
 * mejores marcas aparecen vacías para un ejercicio con años de historial.
 *
 * Reproduce **solo** los ejercicios que están en esa situación —tienen series de trabajo y ninguna
 * fila de récord—, así que con el cache al día esto cuesta un select que no devuelve nada. Un
 * ejercicio cuyo historial entero no da ningún récord (peso corporal que nunca se superó) vuelve a
 * salir en cada arranque, pero su replay no escribe una sola fila.
 */
export function backfillPrs(): void {
  const pending = db
    .selectDistinct({ id: sessionExercise.exerciseId })
    .from(sessionExercise)
    .innerJoin(vWorkSet, eq(vWorkSet.sessionExerciseId, sessionExercise.id))
    .where(
      notExists(
        db
          .select({ one: sql`1` })
          .from(personalRecord)
          .where(eq(personalRecord.exerciseId, sessionExercise.exerciseId)),
      ),
    )
    .all()
  if (pending.length === 0) return
  db.transaction((tx) => {
    for (const row of pending) replay(tx, row.id)
  })
}

/** H06/H07: la línea de tiempo de récords del ejercicio, del más nuevo al más viejo. */
export function listPrs(
  exerciseId: number,
  limit = 20,
): Array<PersonalRecordRow & { set: SetRow }> {
  return db
    .select({ pr: getTableColumns(personalRecord), set: getTableColumns(setEntry) })
    .from(personalRecord)
    .innerJoin(setEntry, eq(setEntry.id, personalRecord.setEntryId))
    .where(eq(personalRecord.exerciseId, exerciseId))
    .orderBy(desc(personalRecord.achievedAt), desc(personalRecord.id))
    .limit(limit)
    .all()
    .map(({ pr, set }) => ({ ...pr, set }))
}

/**
 * Las mejores marcas de hoy. Se leen del cache y no de `v_work_set` porque los récords son
 * estrictamente crecientes: el máximo por tipo ES el último récord de ese tipo.
 */
export function currentBests(exerciseId: number): {
  weightG: number | null
  e1rmG: number | null
  volumeG: number | null
} {
  const rows = db
    .select({ kind: personalRecord.kind, valueG: sql<number>`max(${personalRecord.valueG})` })
    .from(personalRecord)
    .where(eq(personalRecord.exerciseId, exerciseId))
    .groupBy(personalRecord.kind)
    .all()
  const by = new Map(rows.map((r) => [r.kind, r.valueG]))
  return {
    e1rmG: by.get('e1rm') ?? null,
    volumeG: by.get('volume') ?? null,
    weightG: by.get('weight') ?? null,
  }
}
