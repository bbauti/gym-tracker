import { eq } from 'drizzle-orm'
import { db } from '../client'
import { settings } from '../schema'

export type Settings = typeof settings.$inferSelect

export function getSettings(): Settings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get()
  if (!row) throw new Error('settings row missing: seed() did not run before this read')
  return row
}

export function updateSettings(patch: Partial<Omit<Settings, 'id'>>): void {
  if (Object.keys(patch).length === 0) return
  db.update(settings).set(patch).where(eq(settings.id, 1)).run()
}
