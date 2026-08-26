import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, type SQL, sql } from 'drizzle-orm'
import type { Locale } from '@/i18n'
import { db } from '../client'
import {
  type Equipment,
  exercise,
  type Metric,
  type Muscle,
  type Pattern,
  session,
  sessionExercise,
  setEntry,
} from '../schema'
import type { SessionRow, SetRow } from './session'

export type Exercise = typeof exercise.$inferSelect

export type ExerciseFilters = {
  muscle?: Muscle
  equipment?: Equipment
  favoritesOnly?: boolean
  includeArchived?: boolean
}

// ponytail: `muscle` matches the primary muscle only. Secondary muscles live in a JSON column and
// filtering them needs json_each. Upgrade path = a muscle join table, when the library grows filters
// worth that much.
function conditions(filters?: ExerciseFilters): SQL[] {
  const where: SQL[] = []
  if (!filters?.includeArchived) where.push(eq(exercise.isArchived, false))
  if (filters?.muscle) where.push(eq(exercise.primaryMuscle, filters.muscle))
  if (filters?.equipment) where.push(eq(exercise.equipment, filters.equipment))
  if (filters?.favoritesOnly) where.push(eq(exercise.isFavorite, true))
  return where
}

export function listExercises(opts?: ExerciseFilters & { locale?: Locale }): Exercise[] {
  return db
    .select()
    .from(exercise)
    .where(and(...conditions(opts)))
    .orderBy(asc(opts?.locale === 'en' ? exercise.nameEn : exercise.nameEs))
    .all()
}

/** `press ban` → `"press"* "ban"*` — every token a prefix, all of them required. */
function ftsMatch(q: string, maxLen = Number.POSITIVE_INFINITY): string {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.slice(0, maxLen).replaceAll('"', '""')}"*`)
    .join(' ')
}

// ponytail: two queries because drizzle can't map a raw join back to typed columns. ~100-row
// catalogue, both hit an index. Upgrade path = declare exercise_fts as a drizzle table.
function rankedIds(match: string): number[] {
  return db
    .all<{ id: number }>(sql`
      select rowid as id from exercise_fts where exercise_fts match ${match} order by rank
    `)
    .map((r) => r.id)
}

export function searchExercises(
  q: string,
  locale: Locale = 'es',
  filters?: ExerciseFilters,
): Exercise[] {
  const match = ftsMatch(q)
  if (!match) return listExercises({ ...filters, locale })

  // ponytail: si el prefijo exacto no da nada, se reintenta con 4 letras por token — `presion`
  // no es prefijo de `press` y el DoD pide que lo encuentre. Techo: no corrige typos internos
  // (`prezz`). Upgrade path = tokenizer trigram o distancia de edición.
  const ids = rankedIds(match)
  const ranked = ids.length > 0 ? ids : rankedIds(ftsMatch(q, 4))
  if (ranked.length === 0) return []

  const byId = new Map(
    db
      .select()
      .from(exercise)
      .where(and(inArray(exercise.id, ranked), ...conditions(filters)))
      .all()
      .map((e) => [e.id, e] as const),
  )
  return ranked.flatMap((id) => byId.get(id) ?? [])
}

export function getExercise(id: number): Exercise | null {
  return db.select().from(exercise).where(eq(exercise.id, id)).get() ?? null
}

export function exerciseName(e: { nameEs: string; nameEn: string }, locale: Locale): string {
  return locale === 'es' ? e.nameEs : e.nameEn
}

export function createExercise(input: {
  nameEs: string
  nameEn: string
  primaryMuscle: Muscle
  secondaryMuscles?: Muscle[]
  equipment: Equipment
  pattern?: Pattern | null
  metric: Metric
  defaultIncrementG?: number | null
  defaultRestSec?: number | null
}): number {
  return db
    .insert(exercise)
    .values({ ...input, isCustom: true })
    .returning({ id: exercise.id })
    .get().id
}

export type ExercisePatch = Partial<
  Pick<
    Exercise,
    | 'nameEs'
    | 'nameEn'
    | 'primaryMuscle'
    | 'secondaryMuscles'
    | 'equipment'
    | 'pattern'
    | 'metric'
    | 'notes'
    | 'defaultIncrementG'
    | 'defaultRestSec'
    | 'isFavorite'
    | 'isArchived'
  >
>

/** The seed overwrites catalogue columns on every version bump, so editing them there is a lie. */
const SEED_WRITABLE = new Set<keyof ExercisePatch>([
  'notes',
  'isFavorite',
  'isArchived',
  'defaultIncrementG',
  'defaultRestSec',
])

export function updateExercise(id: number, patch: ExercisePatch): void {
  const keys = Object.keys(patch) as (keyof ExercisePatch)[]
  if (keys.length === 0) return

  const row = db
    .select({ isCustom: exercise.isCustom })
    .from(exercise)
    .where(eq(exercise.id, id))
    .get()
  if (!row) throw new Error(`exercise ${id} not found`)
  if (!row.isCustom) {
    const blocked = keys.filter((k) => !SEED_WRITABLE.has(k))
    if (blocked.length > 0) {
      throw new Error(`exercise ${id} is seeded: ${blocked.join(', ')} cannot be edited`)
    }
  }

  db.update(exercise).set(patch).where(eq(exercise.id, id)).run()
}

/** Distinct exercises by last time they were trained — the top of the pick-exercise sheet. */
export function recentExercises(limit = 20): Exercise[] {
  return db
    .select(getTableColumns(exercise))
    .from(exercise)
    .innerJoin(sessionExercise, eq(sessionExercise.exerciseId, exercise.id))
    .innerJoin(session, eq(session.id, sessionExercise.sessionId))
    .where(eq(exercise.isArchived, false))
    .groupBy(exercise.id)
    .orderBy(desc(sql`max(${session.startedAt})`))
    .limit(limit)
    .all()
}

/** Newest first, completed sets only, grouped by session. Two round trips. */
export function exerciseHistory(
  exerciseId: number,
  limit = 20,
): Array<{ session: SessionRow; sets: SetRow[] }> {
  const sessions = db
    .select(getTableColumns(session))
    .from(session)
    .innerJoin(sessionExercise, eq(sessionExercise.sessionId, session.id))
    .innerJoin(setEntry, eq(setEntry.sessionExerciseId, sessionExercise.id))
    .where(and(eq(sessionExercise.exerciseId, exerciseId), isNotNull(setEntry.completedAt)))
    .groupBy(session.id)
    .orderBy(desc(session.startedAt), desc(session.id))
    .limit(limit)
    .all()

  if (sessions.length === 0) return []

  const rows = db
    .select({ sessionId: sessionExercise.sessionId, ...getTableColumns(setEntry) })
    .from(setEntry)
    .innerJoin(sessionExercise, eq(sessionExercise.id, setEntry.sessionExerciseId))
    .where(
      and(
        eq(sessionExercise.exerciseId, exerciseId),
        inArray(
          sessionExercise.sessionId,
          sessions.map((s) => s.id),
        ),
        isNotNull(setEntry.completedAt),
      ),
    )
    .orderBy(asc(sessionExercise.orderIndex), asc(setEntry.orderIndex), asc(setEntry.id))
    .all()

  const bySession = new Map<number, SetRow[]>()
  for (const { sessionId, ...set } of rows) {
    const list = bySession.get(sessionId)
    if (list) list.push(set)
    else bySession.set(sessionId, [set])
  }

  return sessions.map((s) => ({ session: s, sets: bySession.get(s.id) ?? [] }))
}
