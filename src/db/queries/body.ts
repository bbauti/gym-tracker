import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '../client'
import { bodyMetric } from '../schema'

/**
 * I01–I03. Medidas del cuerpo, sobre `body_metric`.
 *
 * `value` es gramos para `bodyweight` y milímetros para el resto: la columna es una sola y la
 * unidad la pone el tipo de medida, igual que el resto de la app (pesos en g, largos en mm).
 */
export const BODY_KINDS = [
  'bodyweight',
  'waist',
  'chest',
  'hips',
  'shoulders',
  'neck',
  'arm_left',
  'arm_right',
  'thigh_left',
  'thigh_right',
  'calf_left',
  'calf_right',
] as const

export type BodyKind = (typeof BODY_KINDS)[number]

/** `kind` es TEXT libre en el schema: se estrecha acá, en el borde de la query, una sola vez. */
export type BodyMetricRow = Omit<typeof bodyMetric.$inferSelect, 'kind'> & { kind: BodyKind }

const DAY_MS = 86_400_000

export function latest(kind: BodyKind): BodyMetricRow | null {
  const row = db
    .select()
    .from(bodyMetric)
    .where(eq(bodyMetric.kind, kind))
    .orderBy(desc(bodyMetric.measuredAt), desc(bodyMetric.id))
    .limit(1)
    .get()
  return (row as BodyMetricRow | undefined) ?? null
}

/**
 * La última medida de cada tipo, para la lista. Un solo scan: con `max()` sqlite garantiza que las
 * columnas peladas salen de la MISMA fila que el máximo (bare columns, doc de max/min), así que no
 * hacen falta doce queries ni una ventana.
 */
export function latestAll(): Partial<Record<BodyKind, BodyMetricRow>> {
  const rows = db
    .select({
      id: bodyMetric.id,
      kind: bodyMetric.kind,
      measuredAt: sql<number>`max(${bodyMetric.measuredAt})`,
      value: bodyMetric.value,
    })
    .from(bodyMetric)
    .groupBy(bodyMetric.kind)
    .all() as BodyMetricRow[]

  const out: Partial<Record<BodyKind, BodyMetricRow>> = {}
  for (const row of rows) out[row.kind] = row
  return out
}

/** Para el gráfico: de la más vieja a la más nueva, que es como se dibuja. */
export function series(kind: BodyKind, days: number): BodyMetricRow[] {
  const from = Date.now() - days * DAY_MS
  return db
    .select()
    .from(bodyMetric)
    .where(and(eq(bodyMetric.kind, kind), gte(bodyMetric.measuredAt, from)))
    .orderBy(asc(bodyMetric.measuredAt), asc(bodyMetric.id))
    .all() as BodyMetricRow[]
}

/**
 * Para la lista de entradas: la más nueva primero y sin ventana de días — lo que el gráfico deja
 * afuera igual se tiene que poder ver y borrar.
 */
export function history(kind: BodyKind, limit: number): BodyMetricRow[] {
  return db
    .select()
    .from(bodyMetric)
    .where(eq(bodyMetric.kind, kind))
    .orderBy(desc(bodyMetric.measuredAt), desc(bodyMetric.id))
    .limit(limit)
    .all() as BodyMetricRow[]
}

export function addMetric(kind: BodyKind, value: number, at: number = Date.now()): number {
  return db
    .insert(bodyMetric)
    .values({ kind, measuredAt: at, value })
    .returning({ id: bodyMetric.id })
    .get().id
}

export function deleteMetric(id: number): BodyMetricRow {
  const row = db.delete(bodyMetric).where(eq(bodyMetric.id, id)).returning().get()
  if (!row) throw new Error(`body metric ${id} not found`)
  return row as BodyMetricRow
}

/** Mismo id: deshacer devuelve la fila que estaba, no crea una medida nueva con la fecha de hoy. */
export function restoreMetric(row: BodyMetricRow): void {
  db.insert(bodyMetric).values(row).run()
}
