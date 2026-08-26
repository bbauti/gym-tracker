import { drizzle } from 'drizzle-orm/expo-sqlite'
import { migrate } from 'drizzle-orm/expo-sqlite/migrator'
import { openDatabaseSync } from 'expo-sqlite'
import migrations from './migrations/migrations'
import * as schema from './schema'
import { seed } from './seed'

export const sqlite = openDatabaseSync('gym.db', { enableChangeListener: true })
sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

export const db = drizzle(sqlite, { schema })

/** Awaited once by the root layout: `use(ready)` inside a <Suspense>. Every query assumes it resolved. */
export const ready: Promise<void> = migrate(db, migrations).then(() => seed(db))
