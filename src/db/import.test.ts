import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackupError, importInto, type SqlLike, wipeInto } from './import'

/** bun:sqlite standing in for expo-sqlite's SQLiteDatabase — the two agree on this much. */
const adapt = (db: Database): SqlLike => ({
  execSync: (sql: string) => db.exec(sql),
  getAllSync: <T>(sql: string) => db.query(sql).all() as T[],
})

/** Same statements the app runs on a cold start: the drizzle migrations plus the log they leave. */
function migrate(db: Database): void {
  for (const file of ['0000_init.sql', '0001_fts.sql']) {
    const sql = readFileSync(join(import.meta.dir, 'migrations', file), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) db.exec(statement)
    }
  }
  db.exec(
    'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  )
  db.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('0000', 1), ('0001', 2)")
}

function seedRows(db: Database): void {
  db.exec(`
    INSERT INTO gym (id, name) VALUES (1, 'Sede centro');
    INSERT INTO exercise (id, seed_id, name_es, name_en, aliases, primary_muscle, equipment, metric, instructions_es, gym_id)
    VALUES (1, 'bench_press', 'Press banca', 'Bench press', '["pecho"]', 'chest', 'barbell', 'weight_reps', 'Bajá controlado', 1),
           (2, 'squat', 'Sentadilla', 'Squat', '["piernas"]', 'quads', 'barbell', 'weight_reps', NULL, NULL);
    INSERT INTO session (id, name, started_at) VALUES (1, 'Torso', 1000);
    INSERT INTO session_exercise (id, session_id, exercise_id, order_index) VALUES (1, 1, 1, 0);
    INSERT INTO set_entry (id, session_exercise_id, order_index, kind, weight_g, reps, completed_at)
    VALUES (1, 1, 0, 'normal', 60000, 10, 1200),
           (2, 1, 1, 'normal', 62500, 8, 1300);
    INSERT INTO personal_record (id, exercise_id, kind, value_g, reps, set_entry_id, achieved_at)
    VALUES (1, 1, 'weight', 62500, 8, 2, 1300);
  `)
}

let dir: string
let main: Database
let target: SqlLike

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gym-import-'))
  main = new Database(join(dir, 'main.db'), { create: true })
  main.exec('PRAGMA foreign_keys = ON')
  migrate(main)
  seedRows(main)
  target = adapt(main)
})

afterEach(() => {
  main.close()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * A backup of an older build: one row edited, one row added, and a nullable column that did not
 * exist yet (dropped from the copy).
 */
function olderBackup(mutate: (db: Database) => void = () => {}): string {
  const path = join(dir, 'backup.db')
  copyFileSync(join(dir, 'main.db'), path)
  const src = new Database(path)
  src.exec(
    "UPDATE exercise SET name_es = 'Press inclinado', name_en = 'Incline press' WHERE id = 1",
  )
  src.exec(`
    INSERT INTO set_entry (id, session_exercise_id, order_index, kind, weight_g, reps, completed_at)
    VALUES (3, 1, 2, 'normal', 65000, 6, 1400)
  `)
  src.exec('ALTER TABLE exercise DROP COLUMN instructions_es')
  mutate(src)
  src.close()
  return path
}

const names = () =>
  main.query('SELECT name_es FROM exercise ORDER BY id').all() as { name_es: string }[]
const setCount = () => (main.query('SELECT count(*) AS n FROM set_entry').get() as { n: number }).n
const one = (sql: string) => main.query(sql).get()

test('restores every row of the backup over the live database', () => {
  const path = olderBackup()
  main.exec("UPDATE exercise SET name_es = 'Editado despues del backup' WHERE id = 1")
  main.exec('DELETE FROM set_entry WHERE id = 2')

  importInto(target, path)

  expect(names().map((r) => r.name_es)).toEqual(['Press inclinado', 'Sentadilla'])
  expect(setCount()).toBe(3)
  expect(main.query('SELECT reps FROM set_entry WHERE id = 3').get()).toEqual({ reps: 6 })
})

/**
 * The restore used to empty and refill one table at a time, so `DELETE FROM gym` ran AFTER the
 * `exercise` rows were back (nulling their `gym_id`) and `DELETE FROM set_entry` after the records
 * were back (cascading them away). `defer_foreign_keys` does not help: it defers checks, not
 * actions.
 */
test('rows survive the delete of a parent restored later in the pass', () => {
  const path = olderBackup()
  main.exec('UPDATE exercise SET gym_id = NULL')
  main.exec('DELETE FROM personal_record')

  importInto(target, path)

  expect(one('SELECT gym_id FROM exercise WHERE id = 1')).toEqual({ gym_id: 1 })
  expect(one('SELECT count(*) AS n FROM gym')).toEqual({ n: 1 })
  expect(main.query('SELECT id, set_entry_id FROM personal_record ORDER BY id').all()).toEqual([
    { id: 1, set_entry_id: 2 },
  ])
})

test('a column the backup never had keeps its default instead of failing', () => {
  importInto(target, olderBackup())

  expect(main.query('SELECT instructions_es FROM exercise WHERE id = 1').get()).toEqual({
    instructions_es: null,
  })
})

test('full-text search finds a restored exercise by its backed-up name', () => {
  importInto(target, olderBackup())

  const hit = main
    .query("SELECT rowid FROM exercise_fts WHERE exercise_fts MATCH 'inclinado'")
    .all()
  expect(hit).toEqual([{ rowid: 1 }])
  expect(
    main.query("SELECT rowid FROM exercise_fts WHERE exercise_fts MATCH 'banca'").all(),
  ).toEqual([])
})

test('a backup from a newer schema is refused and changes nothing', () => {
  const path = olderBackup((src) => {
    src.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('0002', 3)")
  })

  expect(() => importInto(target, path)).toThrow(BackupError)
  try {
    importInto(target, path)
  } catch (error) {
    expect((error as BackupError).code).toBe('newer_schema')
  }
  expect(names().map((r) => r.name_es)).toEqual(['Press banca', 'Sentadilla'])
  expect(setCount()).toBe(2)
})

test('a file that is not a database is refused and changes nothing', () => {
  const path = join(dir, 'notes.txt')
  writeFileSync(path, 'esto no es una base de datos')

  try {
    importInto(target, path)
    throw new Error('expected importInto to throw')
  } catch (error) {
    expect(error).toBeInstanceOf(BackupError)
    expect((error as BackupError).code).toBe('invalid_file')
  }
  expect(names().map((r) => r.name_es)).toEqual(['Press banca', 'Sentadilla'])
  expect(setCount()).toBe(2)
})

test('a database without our tables is refused and changes nothing', () => {
  const path = join(dir, 'empty.db')
  const empty = new Database(path, { create: true })
  empty.exec('CREATE TABLE unrelated (id integer primary key)')
  empty.close()

  try {
    importInto(target, path)
    throw new Error('expected importInto to throw')
  } catch (error) {
    expect((error as BackupError).code).toBe('invalid_file')
  }
  expect(setCount()).toBe(2)
})

test('wipe empties the user tables and the search index, and can be restored from', () => {
  const path = olderBackup()

  wipeInto(target)
  expect(names()).toEqual([])
  expect(setCount()).toBe(0)
  expect(main.query('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 2 })

  importInto(target, path)
  expect(setCount()).toBe(3)
})
