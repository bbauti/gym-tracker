import { getDocumentAsync } from 'expo-document-picker'
import { Directory, File, Paths } from 'expo-file-system'
import { shareAsync } from 'expo-sharing'
import { AppState } from 'react-native'
import { parseHistoryCsv } from '@/lib/historyCsv'
import { gToUnit } from '@/lib/units'
import { db, sqlite } from './client'
import { BackupError, importInto, type SqlLike, wipeInto } from './import'
import { type ImportHistoryResult, importHistory } from './queries/importHistory'
import { backfillPrs } from './queries/prs'
import { seed } from './seed'
import { notifyAll } from './useQuery'

export { BackupError, type BackupErrorCode, type SqlLike } from './import'

export type BackupInfo = { name: string; path: string; size: number; modifiedAt: number }

/** Rotating copies kept in the app's document directory. Three is ~3 MB and covers a bad week. */
const KEEP = 3
const AUTO_BACKUP_EVERY_MS = 10 * 60_000

/** Every table whose rows are the user's, in dependency order. Used by the JSON export. */
const TABLES = [
  'settings',
  'gym',
  'exercise',
  'folder',
  'routine',
  'routine_day',
  'routine_exercise',
  'routine_set',
  'session',
  'session_exercise',
  'set_entry',
  'body_metric',
  'personal_record',
] as const

// expo-sqlite hands out bare filesystem paths, expo-file-system speaks file:// URIs, and ATTACH
// wants a bare path again. These two are the whole translation layer.
const toUri = (path: string) => (path.startsWith('file://') ? path : `file://${path}`)
const toPath = (uri: string) =>
  uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d = new Date()) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
const localIso = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Anything native that blows up becomes a BackupError: the UI only ever switches on `code`. */
const wrap = (error: unknown) =>
  error instanceof BackupError ? error : new BackupError('unsupported', error)

function guard<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    throw wrap(error)
  }
}

/**
 * The database runs in WAL, so the .db file alone is stale until the log is folded back into it.
 * TRUNCATE also empties the -wal file, which is why copying the single main file is enough.
 */
function checkpoint(): void {
  // It reports failure, it does not raise it: busy = 1 means the log stayed put and the .db file we
  // are about to copy is missing everything written since the last checkpoint.
  const [row] = sqlite.getAllSync<{ busy: number }>('PRAGMA wal_checkpoint(TRUNCATE)')
  if (row && row.busy !== 0) throw new BackupError('unsupported', 'wal_checkpoint busy')
}

const backupsDir = () => new Directory(Paths.document, 'backups')

/**
 * `gym-<epoch ms>.db` → the ms. `copySync` preserves the source's mtime on iOS, so every backup
 * would otherwise carry the database's last-write time: same stamp for all three, and rotation, the
 * auto-backup throttle and the dates on screen all reading the wrong thing.
 */
const stampOf = (name: string) => Number(/^gym-(\d+)\.db$/.exec(name)?.[1] ?? 0)

const describe = (file: File): BackupInfo => ({
  name: file.name,
  path: toPath(file.uri),
  size: file.size,
  modifiedAt: stampOf(file.name) || file.lastModified || 0,
})

/** Checkpoints and copies the live database somewhere else. The copy is a full, openable database. */
function copyDatabaseTo(destination: File): File {
  checkpoint()
  new File(toUri(sqlite.databasePath)).copySync(destination, { overwrite: true })
  return destination
}

/** Wraps here and not in `guard`: a rejected promise escapes a synchronous try/catch. */
async function share(file: File, uti: string, mimeType: string): Promise<void> {
  try {
    await shareAsync(file.uri, { UTI: uti, mimeType, dialogTitle: file.name })
  } catch (error) {
    throw wrap(error)
  }
}

/** The real thing: a database file that restores byte for byte. */
export async function exportDatabase(): Promise<void> {
  const file = guard(() => copyDatabaseTo(new File(Paths.cache, `gym-tracker-${stamp()}.db`)))
  await share(file, 'public.database', 'application/octet-stream')
}

/** Raw rows, snake_case columns as stored — readable without this app, restorable by hand. */
export async function exportJson(): Promise<void> {
  const file = guard(() => {
    const tables: Record<string, unknown[]> = {}
    for (const table of TABLES) tables[table] = sqlite.getAllSync(`SELECT * FROM ${table}`)
    const payload = {
      app: 'gym-tracker',
      schemaVersion: sqlite.getAllSync<{ n: number }>(
        'SELECT count(*) AS n FROM __drizzle_migrations',
      )[0].n,
      exportedAt: Date.now(),
      tables,
    }
    const target = new File(Paths.cache, `gym-tracker-${stamp()}.json`)
    target.write(JSON.stringify(payload))
    return target
  })
  await share(file, 'public.json', 'application/json')
}

/**
 * N02. Un objeto a un .json en cache y directo a la hoja de compartir (exportar una rutina).
 * El nombre lo escribió el usuario, así que todo lo que no sea letra o número se aplana: una barra
 * en "Push/Pull" sería un directorio que no existe.
 */
export async function shareJsonFile(name: string, data: unknown): Promise<void> {
  const slug = name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  const file = guard(() => {
    const target = new File(Paths.cache, `${slug || 'gym-tracker'}-${stamp()}.json`)
    target.write(JSON.stringify(data))
    return target
  })
  await share(file, 'public.json', 'application/json')
}

type CsvRow = {
  started_at: number
  completed_at: number | null
  session_name: string | null
  exercise_es: string
  exercise_en: string
  set_index: number
  kind: string
  weight_g: number | null
  reps: number | null
  duration_ms: number | null
  distance_mm: number | null
  rpe: number | null
  rir: number | null
  completed: number
  note: string | null
}

const CSV_HEADER = [
  'date',
  'session_name',
  'exercise_es',
  'exercise_en',
  'set_index',
  'kind',
  'weight_kg',
  'reps',
  'duration_s',
  'distance_m',
  'rpe',
  'rir',
  'completed',
  'note',
]

/** RFC 4180: quote only when needed, double the quotes inside, CRLF between records. */
function cell(value: string | number | null): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Integer storage unit → plain decimal, max 3 digits, always a '.' (no locale formatting). */
const decimal = (value: number | null) => (value === null ? '' : String(Number(value.toFixed(3))))

/** One line per set, ready for a spreadsheet. */
export async function exportCsv(): Promise<void> {
  const file = guard(() => {
    const rows = sqlite.getAllSync<CsvRow>(`
      SELECT s.started_at, st.completed_at, s.name AS session_name,
             e.name_es AS exercise_es, e.name_en AS exercise_en,
             st.order_index AS set_index, st.kind, st.weight_g, st.reps,
             st.duration_ms, st.distance_mm, st.rpe, st.rir,
             st.completed_at IS NOT NULL AS completed, st.note
      FROM set_entry st
      JOIN session_exercise sx ON sx.id = st.session_exercise_id
      JOIN session s ON s.id = sx.session_id
      JOIN exercise e ON e.id = sx.exercise_id
      ORDER BY s.started_at, sx.order_index, st.order_index
    `)

    const lines = [CSV_HEADER.join(',')]
    for (const r of rows) {
      lines.push(
        [
          localIso(r.completed_at ?? r.started_at),
          r.session_name,
          r.exercise_es,
          r.exercise_en,
          r.set_index + 1, // 1-based: the CSV is read by a human, the JSON export keeps the raw index
          r.kind,
          decimal(r.weight_g === null ? null : gToUnit(r.weight_g, 'kg')),
          r.reps,
          decimal(r.duration_ms === null ? null : r.duration_ms / 1000),
          decimal(r.distance_mm === null ? null : r.distance_mm / 1000),
          r.rpe,
          r.rir,
          r.completed,
          r.note,
        ]
          .map(cell)
          .join(','),
      )
    }

    const target = new File(Paths.cache, `gym-tracker-${stamp()}.csv`)
    target.write(`${lines.join('\r\n')}\r\n`)
    return target
  })
  await share(file, 'public.comma-separated-values-text', 'text/csv')
}

/** Sync on purpose: it runs while the app is being backgrounded, where a promise may not resolve. */
export function backupNow(): BackupInfo {
  return guard(() => {
    const dir = backupsDir()
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true })

    const file = copyDatabaseTo(new File(dir, `gym-${Date.now()}.db`))
    for (const old of listBackups().slice(KEEP)) new File(toUri(old.path)).delete()
    return describe(file)
  })
}

/** Newest first. */
export function listBackups(): BackupInfo[] {
  return guard(() => {
    const dir = backupsDir()
    if (!dir.exists) return []
    return dir
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.db'))
      .map(describe)
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
  })
}

/** Resolves false when the user backs out of the picker; throws BackupError on a bad file. */
export async function restoreFromFile(): Promise<boolean> {
  const picked = await getDocumentAsync({
    // iOS types a .db as octet-stream, some file managers as x-sqlite3, iCloud Drive as neither.
    type: ['application/octet-stream', 'application/x-sqlite3', '*/*'],
    copyToCacheDirectory: true,
  }).catch((error: unknown) => {
    throw wrap(error)
  })
  if (picked.canceled || !picked.assets[0]) return false
  // The undo for "restored the wrong file". Not inside importDatabase: restoreFromBackup reads from
  // backups/, where the KEEP rotation could delete the very file being restored.
  backupNow()
  importDatabase(toPath(picked.assets[0].uri))
  return true
}

export function restoreFromBackup(path: string): void {
  importDatabase(path)
}

/**
 * Importa un CSV de historial: el que escribe `exportCsv` o uno hecho a mano con esas columnas.
 * Resuelve `null` cuando cierran el picker, y tira BackupError si el archivo no se entiende.
 *
 * Suma al historial, no lo reemplaza — pero igual deja un backup antes, que es el único deshacer.
 */
export async function importHistoryFromFile(): Promise<
  (ImportHistoryResult & { skipped: number }) | null
> {
  const picked = await getDocumentAsync({
    // Un .csv llega como text/csv, como text/plain o sin tipo según de dónde salga.
    type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
  }).catch((error: unknown) => {
    throw wrap(error)
  })
  if (picked.canceled || !picked.assets[0]) return null

  const text = await new File(picked.assets[0].uri).text().catch((error: unknown) => {
    throw wrap(error)
  })
  // Sin cabecera reconocible, o sin una sola fila legible, no hay nada que importar.
  const parsed = parseHistoryCsv(text)
  if (!parsed || parsed.sessions.length === 0) throw new BackupError('invalid_file')

  backupNow()
  // Los pesos del export están SIEMPRE en kg, no en la unidad de la app: el default es kg y solo una
  // columna `unit` por fila lo cambia (la resuelve `importHistory`).
  const result = guard(() => importHistory(parsed))
  notifyAll()
  // `skipped` sube: media importación en silencio es peor que un archivo que no se entiende.
  return { ...result, skipped: parsed.skipped }
}

/**
 * Replaces the whole database with the file at `path`, or throws and leaves it untouched.
 * `target` exists so the core can be driven from tests; the app always uses the live connection.
 */
export function importDatabase(path: string, target: SqlLike = sqlite): void {
  importInto(target, path)
  // A backup taken before the last catalogue update comes back missing exercises: re-seeding puts
  // them back without touching anything the user edited (see seed.ts upsert rules).
  seed(db)
  // Un backup de antes de la Fase 5 vuelve con historial y sin récords: se reconstruyen del historial.
  backfillPrs()
  notifyAll()
}

/** Erases everything. Takes a backup first, and hands it back so the UI can offer an undo. */
export function wipeAll(): BackupInfo {
  const backup = backupNow()
  // An empty copy is not an undo. Nothing native reports this as an error, so check it here.
  if (backup.size === 0) throw new BackupError('unsupported', 'empty backup')
  guard(() => wipeInto(sqlite))
  seed(db)
  notifyAll()
  return backup
}

/**
 * Backs up on the way to the background, which is the last moment before iOS may kill the app.
 * ponytail: the trigger is AppState alone. Techo: nothing protects a session logged and lost within
 * the same foreground stretch. Upgrade: also back up when a session ends.
 */
export function startAutoBackup(): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'background') return
    try {
      const newest = listBackups()[0]
      if (newest && Date.now() - newest.modifiedAt < AUTO_BACKUP_EVERY_MS) return
      backupNow()
    } catch {
      // A failed backup is never worth crashing the app the user is walking away from.
    }
  })
  return () => subscription.remove()
}
