import { asc, eq } from 'drizzle-orm'
import { t } from '@/i18n'
import { DEFAULT_BAR_G, DEFAULT_PLATES_G } from '@/lib/plates'
import { db } from '../client'
import { gym, settings } from '../schema'

/**
 * J02/J03. Un gimnasio es la lista de barras y discos que hay ahí: es todo lo que la calculadora
 * necesita para decir qué peso se puede armar. Sin gimnasio activo se usan las tablas por defecto
 * de `@/lib/plates`, así que esto es opcional de punta a punta.
 */

export type Gym = typeof gym.$inferSelect
export type Bar = { name: string; g: number }
export type GymPatch = Partial<Pick<Gym, 'name' | 'platesG' | 'barsG'>>

const SHORT_BAR_G = 15_000

export function listGyms(): Gym[] {
  return db.select().from(gym).orderBy(asc(gym.name), asc(gym.id)).all()
}

export function getGym(id: number): Gym | null {
  return db.select().from(gym).where(eq(gym.id, id)).get() ?? null
}

/** Arranca con lo que hay en cualquier gimnasio; el editor saca lo que no. */
export function createGym(name: string): number {
  return db
    .insert(gym)
    .values({
      name,
      platesG: DEFAULT_PLATES_G,
      barsG: [
        { g: DEFAULT_BAR_G, name: t('gyms.barDefault') },
        { g: SHORT_BAR_G, name: t('gyms.barShort') },
      ],
    })
    .returning({ id: gym.id })
    .get().id
}

export function updateGym(id: number, patch: GymPatch): void {
  if (Object.keys(patch).length === 0) return
  db.update(gym).set(patch).where(eq(gym.id, id)).run()
}

/** La fila y si además era el activo: el FK deja `active_gym_id` en null y deshacer tiene que volver. */
export type GymSnapshot = { row: Gym; wasActive: boolean }

export function deleteGym(id: number): GymSnapshot {
  const wasActive = activeGymId() === id
  const row = db.delete(gym).where(eq(gym.id, id)).returning().get()
  if (!row) throw new Error(`gym ${id} not found`)
  return { row, wasActive }
}

/** Mismo id: los ejercicios que apuntaban al gimnasio quedaron en null, pero el resto vuelve igual. */
export function restoreGym({ row, wasActive }: GymSnapshot): void {
  db.insert(gym).values(row).run()
  if (wasActive) setActiveGym(row.id)
}

function activeGymId(): number | null {
  return (
    db.select({ id: settings.activeGymId }).from(settings).where(eq(settings.id, 1)).get()?.id ??
    null
  )
}

export function setActiveGym(id: number | null): void {
  db.update(settings).set({ activeGymId: id }).where(eq(settings.id, 1)).run()
}

export function activeGym(): Gym | null {
  const id = activeGymId()
  return id === null ? null : getGym(id)
}
