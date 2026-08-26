import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../client'
import { exercise } from '../schema'

export type Exercise = typeof exercise.$inferSelect

export function listExercises(opts?: {
  includeArchived?: boolean
  locale?: 'es' | 'en'
}): Exercise[] {
  return db
    .select()
    .from(exercise)
    .where(opts?.includeArchived ? undefined : eq(exercise.isArchived, false))
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
      select e.id as id
      from exercise_fts f
      join exercise e on e.id = f.rowid
      where exercise_fts match ${match} and e.is_archived = 0
      order by f.rank
    `)
    .map((r) => r.id)
}

export function searchExercises(q: string, locale: 'es' | 'en' = 'es'): Exercise[] {
  const match = ftsMatch(q)
  if (!match) return listExercises({ locale })

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
      .where(and(inArray(exercise.id, ranked), eq(exercise.isArchived, false)))
      .all()
      .map((e) => [e.id, e] as const),
  )
  return ranked.flatMap((id) => byId.get(id) ?? [])
}

export function exerciseName(e: { nameEs: string; nameEn: string }, locale: 'es' | 'en'): string {
  return locale === 'es' ? e.nameEs : e.nameEn
}
