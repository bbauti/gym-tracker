import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../client'
import { folder, routine } from '../schema'

/**
 * D02. Una carpeta es un cajón con nombre y nada más: agrupa rutinas en la tab de entrenar y no
 * cambia en qué orden se entrenan. Borrar el cajón nunca borra lo que había adentro — el FK deja
 * `routine.folder_id` en null y las rutinas siguen listadas sueltas.
 *
 * Como todo lo de `routine*`, esto se escribe SOLO desde las pantallas de rutinas (§2.2).
 */

export type Folder = typeof folder.$inferSelect

export function listFolders(): Folder[] {
  return db.select().from(folder).orderBy(asc(folder.orderIndex), asc(folder.id)).all()
}

export function createFolder(name: string): number {
  return db.transaction((tx) => {
    const next = tx
      .select({ n: sql<number>`coalesce(max(${folder.orderIndex}) + 1, 0)` })
      .from(folder)
      .get()
    return tx
      .insert(folder)
      .values({ name, orderIndex: next?.n ?? 0 })
      .returning({ id: folder.id })
      .get().id
  })
}

export function renameFolder(id: number, name: string): void {
  db.update(folder).set({ name }).where(eq(folder.id, id)).run()
}

/** La fila y las rutinas que colgaban: el FK las soltó, y deshacer tiene que volver a colgarlas. */
export type FolderSnapshot = { row: Folder; routineIds: number[] }

export function deleteFolder(id: number): FolderSnapshot {
  return db.transaction((tx) => {
    const routineIds = tx
      .select({ id: routine.id })
      .from(routine)
      .where(eq(routine.folderId, id))
      .all()
      .map((r) => r.id)
    const row = tx.delete(folder).where(eq(folder.id, id)).returning().get()
    if (!row) throw new Error(`folder ${id} not found`)
    return { routineIds, row }
  })
}

/** Mismo id: las rutinas vuelven al mismo cajón. Las que se borraron mientras tanto, no vuelven. */
export function restoreFolder({ row, routineIds }: FolderSnapshot): void {
  db.transaction((tx) => {
    tx.insert(folder).values(row).run()
    if (routineIds.length > 0) {
      tx.update(routine).set({ folderId: row.id }).where(inArray(routine.id, routineIds)).run()
    }
  })
}

/** Una transacción, así la lista nunca se dibuja a medio reordenar. */
export function reorderFolders(orderedIds: number[]): void {
  db.transaction((tx) => {
    orderedIds.forEach((id, index) => {
      tx.update(folder).set({ orderIndex: index }).where(eq(folder.id, id)).run()
    })
  })
}

/**
 * Cuántas rutinas cuelga cada carpeta, para el subtítulo de la pantalla de carpetas. Las archivadas
 * no cuentan: la tab de entrenar tampoco las lista, así que decir "3 rutinas" y mostrar dos mentiría.
 */
export function folderRoutineCounts(): Map<number, number> {
  const rows = db
    .select({ id: routine.folderId, n: sql<number>`count(*)` })
    .from(routine)
    .where(and(isNotNull(routine.folderId), isNull(routine.archivedAt)))
    .groupBy(routine.folderId)
    .all()
  const counts = new Map<number, number>()
  for (const row of rows) if (row.id !== null) counts.set(row.id, row.n)
  return counts
}
