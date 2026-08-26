import { eq, sql } from 'drizzle-orm'
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite'
import {
  type Equipment,
  exercise,
  type Metric,
  type Muscle,
  type Pattern,
  settings,
} from './schema'
import catalogue from './seed/exercises.json'

type SeedExercise = {
  seedId: string
  nameEs: string
  nameEn: string
  aliases: string[]
  primaryMuscle: Muscle
  secondaryMuscles: Muscle[]
  equipment: Equipment
  pattern: Pattern | null
  // ponytail: METRICS has no weighted-duration variant, so loaded carries (farmers_carry) store
  // time only. Upgrade path = add `weighted_duration` to METRICS + fieldsFor() in the session screen.
  metric: Metric
  defaultIncrementG: number | null
}

const { version, exercises } = catalogue as { version: number; exercises: SeedExercise[] }

// ponytail: la asistencia no se modela. `assisted_pull_up` loguea solo reps porque en una máquina
// asistida más kilos = menos esfuerzo, y volumen/PR/progresión leen weight_g como carga.
// Techo: no se puede seguir la asistencia. Upgrade: flag `is_assisted` en exercise que invierta el
// signo en v_work_set y en detectPrs.
/** Idempotent. Runs on every boot; does real work only when the JSON bumps its version. */
export function seed(db: ExpoSQLiteDatabase<typeof import('./schema')>): void {
  db.transaction((tx) => {
    tx.insert(settings).values({ id: 1 }).onConflictDoNothing().run()

    const current = tx
      .select({ seedVersion: settings.seedVersion })
      .from(settings)
      .where(eq(settings.id, 1))
      .get()
    if (current?.seedVersion === version) return

    for (const e of exercises) {
      tx.insert(exercise)
        .values(e)
        .onConflictDoUpdate({
          target: exercise.seedId,
          // Catalogue columns only — notes, favourite, archived, gym and rest are the user's.
          set: {
            nameEs: sql`excluded.name_es`,
            nameEn: sql`excluded.name_en`,
            aliases: sql`excluded.aliases`,
            primaryMuscle: sql`excluded.primary_muscle`,
            secondaryMuscles: sql`excluded.secondary_muscles`,
            equipment: sql`excluded.equipment`,
            pattern: sql`excluded.pattern`,
            metric: sql`excluded.metric`,
            demoUrl: sql`excluded.demo_url`,
            instructionsEs: sql`excluded.instructions_es`,
            instructionsEn: sql`excluded.instructions_en`,
            defaultIncrementG: sql`excluded.default_increment_g`,
          },
        })
        .run()
    }

    // Retired exercises are never deleted: history references them. Archive them in a later version.
    tx.update(settings).set({ seedVersion: version }).where(eq(settings.id, 1)).run()
  })
}
