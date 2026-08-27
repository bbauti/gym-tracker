import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { ParsedHistory } from '@/lib/historyCsv'
import { type Unit, unitToG } from '@/lib/units'
import { db } from '../client'
import { exercise, SET_KINDS, type SetKind, session, sessionExercise, setEntry } from '../schema'
import { normalizeName } from './exercises'
import { recomputeExercisePrs } from './prs'

/** Igual que en `routines.ts`: expo-sqlite, bun:sqlite y una transacción son el mismo driver sync. */
// biome-ignore lint/suspicious/noExplicitAny: los parámetros del driver, que son justo lo que varía
type Db = BaseSQLiteDatabase<'sync', any, any, any>

export type ImportHistoryResult = {
  sessions: number
  sets: number
  /** Los ejercicios que no estaban en el catálogo y se crearon como propios. */
  created: string[]
  /** Sesiones que ya estaban: re-importar el mismo archivo no duplica nada. */
  duplicates: number
}

function kindOf(kind: string): SetKind {
  const k = kind.trim().toLowerCase()
  return (SET_KINDS as readonly string[]).includes(k) ? (k as SetKind) : 'normal'
}

/**
 * Mete en la base el historial que salió del CSV. Todo en una transacción: o entra el archivo
 * entero o no entra nada.
 *
 * `unit` es la unidad de la columna de peso cuando el archivo no la dice (el export de la app
 * escribe kg siempre); una columna `unit` por fila le gana.
 */
export function importHistory(
  parsed: ParsedHistory,
  { unit = 'kg' }: { unit?: Unit } = {},
): ImportHistoryResult {
  return db.transaction((tx) => run(tx, parsed, unit))
}

function run(tx: Db, parsed: ParsedHistory, unit: Unit): ImportHistoryResult {
  // ponytail: el catálogo entero en memoria para resolver nombres, igual que `importRoutine` (unos
  // cientos de filas, una query). Techo: un archivo con 500 ejercicios lo recorre igual.
  const byName = new Map<string, number>()
  const catalogue = tx
    .select({
      aliases: exercise.aliases,
      id: exercise.id,
      nameEn: exercise.nameEn,
      nameEs: exercise.nameEs,
    })
    .from(exercise)
    .all()
  for (const e of catalogue) {
    for (const name of [e.nameEs, e.nameEn, ...(e.aliases ?? [])]) {
      const key = normalizeName(name)
      if (key && !byName.has(key)) byName.set(key, e.id)
    }
  }

  const created: string[] = []
  const resolve = (nameEs: string, nameEn: string | null): number => {
    for (const name of [nameEs, nameEn]) {
      const known = name ? byName.get(normalizeName(name)) : undefined
      if (known !== undefined) return known
    }
    // Mismo nombre en los dos idiomas cuando el archivo trae uno solo: una columna vacía deja al
    // ejercicio fuera del buscador en la mitad de los teléfonos.
    const id = tx
      .insert(exercise)
      .values({
        equipment: 'other',
        isCustom: true,
        metric: 'weight_reps',
        nameEn: nameEn ?? nameEs,
        nameEs,
        primaryMuscle: 'full_body',
      })
      .returning({ id: exercise.id })
      .get().id
    byName.set(normalizeName(nameEs), id)
    created.push(nameEs)
    return id
  }

  const touched = new Set<number>()
  let sessions = 0
  let sets = 0
  let duplicates = 0

  for (const s of parsed.sessions) {
    // Mismo nombre y horarios que se pisan = la misma sesión, ya sea del mismo archivo o la que se
    // entrenó en la app (su `started_at` real es anterior a la primera serie, así que comparar el
    // inicio exacto no la encontraba y exportar+importar duplicaba todo el historial).
    // Trade-off: dos sesiones distintas con el mismo nombre a la misma hora cuentan como una.
    const already = tx
      .select({ id: session.id })
      .from(session)
      .where(
        and(
          s.name === null ? isNull(session.name) : eq(session.name, s.name),
          lt(session.startedAt, s.endedAt),
          gt(sql`coalesce(${session.endedAt}, ${session.startedAt})`, s.startedAt),
        ),
      )
      .get()
    if (already) {
      duplicates++
      continue
    }

    const sessionId = tx
      .insert(session)
      .values({ endedAt: s.endedAt, name: s.name, startedAt: s.startedAt })
      .returning({ id: session.id })
      .get().id
    sessions++

    // Un mismo ejercicio escrito de dos formas ("Bench press" y "PRESS BANCA") resuelve al mismo id:
    // sus series van a la misma fila de la sesión, no a dos bloques repetidos.
    const blocks = new Map<number, { id: number; sets: number }>()

    for (const ex of s.exercises) {
      const exerciseId = resolve(ex.nameEs, ex.nameEn)
      touched.add(exerciseId)
      const known = blocks.get(exerciseId)
      const block = known ?? {
        id: tx
          .insert(sessionExercise)
          .values({ exerciseId, orderIndex: blocks.size, sessionId })
          .returning({ id: sessionExercise.id })
          .get().id,
        sets: 0,
      }
      if (!known) blocks.set(exerciseId, block)

      const rows = ex.sets.map((set, index) => ({
        completedAt: set.completedAt,
        distanceMm: set.distanceM === null ? null : Math.round(set.distanceM * 1000),
        durationMs: set.durationS === null ? null : Math.round(set.durationS * 1000),
        kind: kindOf(set.kind),
        note: set.note,
        // El índice de la fila manda sobre el `set_index` del archivo: puede venir con huecos.
        orderIndex: block.sets + index,
        reps: set.reps,
        rir: set.rir,
        rpe: set.rpe,
        sessionExerciseId: block.id,
        weightG: set.weight === null ? null : unitToG(set.weight, set.unit ?? unit),
      }))
      if (rows.length === 0) continue
      tx.insert(setEntry).values(rows).run()
      block.sets += rows.length
      sets += rows.length
    }
  }

  // `personal_record` es un cache derivado: sin esto el historial importado no tendría ni un récord.
  for (const exerciseId of touched) recomputeExercisePrs(exerciseId, tx)

  return { created, duplicates, sessions, sets }
}
