/**
 * Restore core. Copies the rows of a backup file into the live database with `ATTACH` + one
 * transaction, instead of replacing the file (the connection in `client.ts` lives at module scope
 * and can never be reopened).
 *
 * Zero expo imports on purpose: `import.test.ts` runs this against bun:sqlite.
 */

/** The slice of expo-sqlite's `SQLiteDatabase` this file uses, so bun:sqlite can stand in for it. */
export type SqlLike = {
  execSync(sql: string): void
  getAllSync<T>(sql: string): T[]
}

export type BackupErrorCode = 'invalid_file' | 'integrity' | 'newer_schema' | 'unsupported'

/**
 * The only error backup/restore throws. `code` is what the UI maps to a localized string; `message`
 * is for logs and never reaches a screen.
 */
export class BackupError extends Error {
  readonly code: BackupErrorCode

  constructor(code: BackupErrorCode, cause?: unknown) {
    super(cause === undefined ? code : `${code}: ${String(cause)}`)
    this.name = 'BackupError'
    this.code = code
  }
}

const quote = (value: string) => value.replace(/'/g, "''")
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`

/**
 * Tables that hold the user's data: everything except sqlite internals, the migration log (main's
 * must survive a restore) and the FTS5 shadow tables. The latter are skipped on purpose: the
 * `exercise_fts_ai/ad/au` triggers are the only thing that writes the index, and they fire on every
 * DELETE and INSERT below, so the index that comes out matches the rows that went in.
 */
function userTables(target: SqlLike, schema: 'main' | 'src'): string[] {
  return target
    .getAllSync<{ name: string }>(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table'`)
    .map((row) => row.name)
    .filter(
      (name) =>
        !name.startsWith('sqlite_') &&
        !name.startsWith('exercise_fts') &&
        name !== '__drizzle_migrations',
    )
}

function columns(target: SqlLike, schema: 'main' | 'src', table: string): string[] {
  return target
    .getAllSync<{ name: string }>(`PRAGMA ${schema}.table_info(${ident(table)})`)
    .map((row) => row.name)
}

function appliedMigrations(target: SqlLike, schema: 'main' | 'src'): number {
  const rows = target.getAllSync<{ n: number }>(
    `SELECT count(*) AS n FROM ${schema}.__drizzle_migrations`,
  )
  return rows[0]?.n ?? 0
}

/**
 * One all-or-nothing transaction. Foreign keys are checked at COMMIT and not per statement, because
 * the graph is broken for most of the body. Careful: this defers the *checks* only — `ON DELETE`
 * actions still run per statement, which is why the delete pass has to finish before the first
 * insert (see `importInto`).
 */
function transaction(target: SqlLike, body: () => void): void {
  target.execSync('BEGIN')
  target.execSync('PRAGMA defer_foreign_keys = ON')
  try {
    body()
    target.execSync('COMMIT') // a deferred FK violation surfaces here, and leaves the tx open
  } catch (error) {
    try {
      target.execSync('ROLLBACK')
    } catch {
      // Already rolled back by sqlite; the original error is the interesting one.
    }
    throw error
  }
}

/** Everything that must hold BEFORE a single row of `main` is touched. */
function validate(target: SqlLike): void {
  const integrity = target.getAllSync<Record<string, string>>('PRAGMA src.integrity_check')
  const verdict = integrity[0] && Object.values(integrity[0])[0]
  if (integrity.length !== 1 || verdict !== 'ok') throw new BackupError('integrity')

  const tables = target
    .getAllSync<{ name: string }>("SELECT name FROM src.sqlite_master WHERE type = 'table'")
    .map((row) => row.name)
  if (!tables.includes('__drizzle_migrations') || !tables.includes('set_entry')) {
    throw new BackupError('invalid_file')
  }

  // A backup written by a newer build can carry columns and tables this one cannot represent.
  if (appliedMigrations(target, 'src') > appliedMigrations(target, 'main')) {
    throw new BackupError('newer_schema')
  }
}

/** Pass one of both the import and the wipe: no row of `main` survives it. */
function deleteAll(target: SqlLike, tables: string[]): void {
  for (const table of tables) target.execSync(`DELETE FROM main.${ident(table)}`)
}

/**
 * Replaces every user row in `target` with the rows of the database file at `path`. Either the
 * whole file lands or nothing does; a throw leaves the database exactly as it was.
 *
 * Column sets are intersected per table, which is what makes OLDER backups restorable: columns the
 * backup never had keep their current default, columns it has that we dropped are ignored.
 */
export function importInto(target: SqlLike, path: string): void {
  try {
    target.execSync(`ATTACH DATABASE '${quote(path)}' AS src`)
  } catch (error) {
    throw new BackupError('invalid_file', error)
  }

  try {
    validate(target)

    transaction(target, () => {
      const tables = userTables(target, 'main')
      // Empty EVERYTHING before inserting anything. Interleaving the two would let a later
      // `DELETE FROM main.gym` fire `ON DELETE SET NULL` over the `exercise` rows just restored
      // (same for the `set_entry` cascade over `personal_record`): `defer_foreign_keys` postpones
      // the checks, never the actions.
      deleteAll(target, tables)

      const inSrc = new Set(userTables(target, 'src'))
      for (const table of tables) {
        if (!inSrc.has(table)) continue

        const available = new Set(columns(target, 'src', table))
        const shared = columns(target, 'main', table).filter((col) => available.has(col))
        if (shared.length === 0) continue

        const list = shared.map(ident).join(', ')
        target.execSync(
          `INSERT INTO main.${ident(table)} (${list}) SELECT ${list} FROM src.${ident(table)}`,
        )
      }
    })
  } finally {
    try {
      target.execSync('DETACH DATABASE src')
    } catch {
      // Nothing attached, or already gone: the error on its way up is the interesting one.
    }
  }
}

/** Empties every user table in one transaction — the import's delete pass, without the refill. */
export function wipeInto(target: SqlLike): void {
  transaction(target, () => deleteAll(target, userTables(target, 'main')))
}
