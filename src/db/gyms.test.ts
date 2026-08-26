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
// `@/i18n` lee el idioma del dispositivo con expo-localization al importarse, que fuera de la app
// no existe. Los nombres de las barras por defecto salen de ahí, así que acá alcanza con la key.
mock.module('@/i18n', () => ({ locale: 'es', t: (key: string) => key }))

// Dinámico a propósito: los `import` estáticos se izan por encima de los `mock.module`.
const { activeGym, createGym, deleteGym, getGym, listGyms, restoreGym, setActiveGym, updateGym } =
  await import('./queries/gyms')

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM gym;
    DELETE FROM sqlite_sequence WHERE name = 'gym';
    INSERT OR IGNORE INTO settings (id) VALUES (1);
    UPDATE settings SET active_gym_id = NULL;
  `)
})

test('createGym leaves a gym you can already load a bar with', () => {
  const gym = getGym(createGym('Casa'))
  expect(gym?.name).toBe('Casa')
  expect(gym?.barsG).toEqual([
    { g: 20_000, name: 'gyms.barDefault' },
    { g: 15_000, name: 'gyms.barShort' },
  ])
  expect(gym?.platesG?.[0]).toBe(25_000)
})

test('listGyms sorts by name', () => {
  createGym('Zona')
  createGym('Atlas')
  expect(listGyms().map((g) => g.name)).toEqual(['Atlas', 'Zona'])
})

test('updateGym writes the json columns and ignores an empty patch', () => {
  const id = createGym('Casa')
  updateGym(id, { barsG: [{ g: 10_000, name: 'Corta' }], platesG: [5_000] })
  expect(getGym(id)?.platesG).toEqual([5_000])
  expect(getGym(id)?.barsG).toEqual([{ g: 10_000, name: 'Corta' }])
  updateGym(id, {})
  expect(getGym(id)?.name).toBe('Casa')
})

test('setActiveGym round trip', () => {
  const id = createGym('Casa')
  expect(activeGym()).toBeNull()
  setActiveGym(id)
  expect(activeGym()?.id).toBe(id)
  setActiveGym(null)
  expect(activeGym()).toBeNull()
})

test('deleting the active gym clears the setting and undo brings it back active', () => {
  const id = createGym('Casa')
  updateGym(id, { platesG: [5_000] })
  setActiveGym(id)

  const snapshot = deleteGym(id)
  expect(getGym(id)).toBeNull()
  expect(activeGym()).toBeNull()

  restoreGym(snapshot)
  expect(getGym(id)?.platesG).toEqual([5_000])
  expect(activeGym()?.id).toBe(id)
})

test('undoing a gym that was not active does not steal the active one', () => {
  const active = createGym('Casa')
  const other = createGym('Box')
  setActiveGym(active)

  restoreGym(deleteGym(other))
  expect(activeGym()?.id).toBe(active)
  expect(listGyms()).toHaveLength(2)
})
