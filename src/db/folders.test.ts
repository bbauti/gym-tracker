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

// Dinámico a propósito: los `import` estáticos se izan por encima del `mock.module`.
const {
  createFolder,
  deleteFolder,
  folderRoutineCounts,
  listFolders,
  renameFolder,
  reorderFolders,
  restoreFolder,
} = await import('./queries/folders')

const routineIn = (folderId: number | null, name: string) =>
  Number(
    (
      sqlite
        .query('INSERT INTO routine (name, folder_id) VALUES (?, ?) RETURNING id')
        .get(name, folderId) as { id: number }
    ).id,
  )

const folderIdOf = (routineId: number) =>
  (
    sqlite.query('SELECT folder_id AS f FROM routine WHERE id = ?').get(routineId) as {
      f: number | null
    }
  ).f

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM routine;
    DELETE FROM folder;
    DELETE FROM sqlite_sequence;
  `)
})

test('las carpetas nuevas van al final y se pueden renombrar y reordenar', () => {
  const a = createFolder('Fuerza')
  const b = createFolder('Volumen')
  const c = createFolder('Casa')
  expect(listFolders().map((f) => [f.name, f.orderIndex])).toEqual([
    ['Fuerza', 0],
    ['Volumen', 1],
    ['Casa', 2],
  ])

  renameFolder(b, 'Hipertrofia')
  reorderFolders([c, a, b])
  expect(listFolders().map((f) => f.name)).toEqual(['Casa', 'Fuerza', 'Hipertrofia'])
})

test('borrar la carpeta no borra las rutinas, y deshacer las vuelve a colgar', () => {
  const folderId = createFolder('Fuerza')
  const inside = routineIn(folderId, 'PPL')
  const outside = routineIn(null, 'Full body')

  const snapshot = deleteFolder(folderId)
  expect(listFolders()).toHaveLength(0)
  expect(snapshot.routineIds).toEqual([inside])
  // El FK es `set null`: la rutina sigue existiendo, suelta.
  expect(folderIdOf(inside)).toBeNull()
  expect(folderIdOf(outside)).toBeNull()

  restoreFolder(snapshot)
  expect(listFolders().map((f) => [f.id, f.name])).toEqual([[folderId, 'Fuerza']])
  expect(folderIdOf(inside)).toBe(folderId)
  expect(folderIdOf(outside)).toBeNull()
})

test('deshacer una carpeta cuyas rutinas ya no están no rompe nada', () => {
  const folderId = createFolder('Fuerza')
  const routineId = routineIn(folderId, 'PPL')
  const snapshot = deleteFolder(folderId)
  sqlite.query('DELETE FROM routine WHERE id = ?').run(routineId)

  expect(() => restoreFolder(snapshot)).not.toThrow()
  expect(listFolders()).toHaveLength(1)
})

test('el conteo de rutinas por carpeta ignora las archivadas y las sueltas', () => {
  const a = createFolder('Fuerza')
  const b = createFolder('Casa')
  routineIn(a, 'PPL')
  const archived = routineIn(a, 'Vieja')
  routineIn(null, 'Full body')
  sqlite.query('UPDATE routine SET archived_at = 1 WHERE id = ?').run(archived)

  const counts = folderRoutineCounts()
  expect(counts.get(a)).toBe(1)
  // Sin rutinas no hay fila en el group by: la pantalla lee el 0 con un `?? 0`.
  expect(counts.get(b)).toBeUndefined()
})
