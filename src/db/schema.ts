import { and, isNotNull, ne, sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  sqliteView,
  text,
} from 'drizzle-orm/sqlite-core'

export const MUSCLES = [
  'chest',
  'back_lats',
  'back_upper',
  'traps',
  'shoulders_front',
  'shoulders_side',
  'shoulders_rear',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'lower_back',
  'glutes',
  'quads',
  'hamstrings',
  'adductors',
  'calves',
  'full_body',
] as const
export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight',
  'kettlebell',
  'band',
  'other',
] as const
export const PATTERNS = [
  'push_h',
  'push_v',
  'pull_h',
  'pull_v',
  'hinge',
  'squat',
  'lunge',
  'carry',
  'isolation',
  'core',
  'cardio',
] as const
export const METRICS = [
  'weight_reps',
  'reps',
  'weighted_bodyweight',
  'duration',
  'distance',
  'duration_distance',
] as const
export const SET_KINDS = [
  'normal',
  'warmup',
  'drop',
  'failure',
  'amrap',
  'rest_pause',
  'giant',
] as const
/**
 * Por qué la app sugiere ese peso (E01–E09). Es lo que la card del ejercicio muestra al pie; el
 * orden es el de precedencia de `suggest()` en `@/lib/progression`.
 */
export const SUGGESTED_REASONS = [
  'none',
  'repeat',
  'linear',
  'double',
  'rpe_easy',
  'rpe_hard',
  'feedback_hard',
  'stall',
  'deload',
] as const

export type Muscle = (typeof MUSCLES)[number]
export type Equipment = (typeof EQUIPMENT)[number]
export type Pattern = (typeof PATTERNS)[number]
export type Metric = (typeof METRICS)[number]
export type SetKind = (typeof SET_KINDS)[number]
export type Reason = (typeof SUGGESTED_REASONS)[number]

/** E09. Las tres preguntas de la hoja de feedback; todas opcionales, todas de una sola escala. */
export type Feedback = { pump?: 1 | 2 | 3; difficulty?: 1 | 2 | 3; pain?: 0 | 1 }

const id = () => integer('id').primaryKey({ autoIncrement: true })

export const settings = sqliteTable(
  'settings',
  {
    id: integer('id').primaryKey(),
    unit: text('unit', { enum: ['kg', 'lb'] })
      .notNull()
      .default('kg'),
    rpeMode: text('rpe_mode', { enum: ['rpe', 'rir', 'none'] })
      .notNull()
      .default('rpe'),
    e1rmFormula: text('e1rm_formula').notNull().default('epley'),
    haptics: integer('haptics', { mode: 'boolean' }).notNull().default(true),
    defaultIncrementG: integer('default_increment_g').notNull().default(2500),
    defaultRestSec: integer('default_rest_sec').notNull().default(90),
    locale: text('locale', { enum: ['es', 'en'] }),
    seedVersion: integer('seed_version').notNull().default(0),
    /** E07: solo lo que el usuario tocó. Lo que falta sale de `DEFAULT_LANDMARKS`. */
    volumeLandmarks: text('volume_landmarks', { mode: 'json' }).$type<
      Partial<Record<Muscle, { mev: number; mav: number; mrv: number }>>
    >(),
    /** E06. Los tres relojes del deload: hasta cuándo está activo, cuándo se descartó el consejo y
     *  cuándo terminó el último. Los dos últimos son ventanas de silencio, no historial. */
    deloadUntil: integer('deload_until'),
    deloadDismissedAt: integer('deload_dismissed_at'),
    deloadEndedAt: integer('deload_ended_at'),
    /** J02: el gimnasio cuyas barras y discos usa la calculadora. `null` = la tabla por defecto. */
    activeGymId: integer('active_gym_id').references(() => gym.id, { onDelete: 'set null' }),
    /** Solo lo piden Wilks y DOTS, que tienen coeficientes distintos por sexo (J09). */
    sex: text('sex', { enum: ['m', 'f'] }),
  },
  (t) => [check('settings_single_row', sql`${t.id} = 1`)],
)

export const gym = sqliteTable('gym', {
  id: id(),
  name: text('name').notNull(),
  platesG: text('plates_g', { mode: 'json' }).$type<number[]>(),
  barsG: text('bars_g', { mode: 'json' }).$type<{ name: string; g: number }[]>(),
})

export const exercise = sqliteTable(
  'exercise',
  {
    id: id(),
    seedId: text('seed_id').unique(),
    nameEs: text('name_es').notNull(),
    nameEn: text('name_en').notNull(),
    aliases: text('aliases', { mode: 'json' }).$type<string[]>(),
    primaryMuscle: text('primary_muscle', { enum: MUSCLES }).notNull(),
    secondaryMuscles: text('secondary_muscles', { mode: 'json' }).$type<Muscle[]>(),
    equipment: text('equipment', { enum: EQUIPMENT }).notNull(),
    pattern: text('pattern', { enum: PATTERNS }),
    metric: text('metric', { enum: METRICS }).notNull().default('weight_reps'),
    demoUrl: text('demo_url'),
    instructionsEs: text('instructions_es'),
    instructionsEn: text('instructions_en'),
    notes: text('notes'),
    gymId: integer('gym_id').references(() => gym.id, { onDelete: 'set null' }),
    isCustom: integer('is_custom', { mode: 'boolean' }).notNull().default(false),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    defaultIncrementG: integer('default_increment_g'),
    defaultRestSec: integer('default_rest_sec'),
  },
  (t) => [
    index('idx_exercise_name_es').on(t.nameEs),
    index('idx_exercise_muscle').on(t.primaryMuscle),
  ],
)

export const folder = sqliteTable('folder', {
  id: id(),
  name: text('name').notNull(),
  orderIndex: integer('order_index').notNull(),
})

export const routine = sqliteTable('routine', {
  id: id(),
  name: text('name').notNull(),
  folderId: integer('folder_id').references(() => folder.id, { onDelete: 'set null' }),
  weeks: integer('weeks'),
  currentDayIndex: integer('current_day_index').notNull().default(0),
  archivedAt: integer('archived_at'),
})

export const routineDay = sqliteTable(
  'routine_day',
  {
    id: id(),
    routineId: integer('routine_id')
      .notNull()
      .references(() => routine.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    orderIndex: integer('order_index').notNull(),
    weekIndex: integer('week_index'),
    isDeload: integer('is_deload', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('idx_routine_day_routine').on(t.routineId)],
)

export const routineExercise = sqliteTable(
  'routine_exercise',
  {
    id: id(),
    dayId: integer('day_id')
      .notNull()
      .references(() => routineDay.id, { onDelete: 'cascade' }),
    // no action, no restrict: RESTRICT ignora PRAGMA defer_foreign_keys y rompería el restore de
    // la Fase 1 (plan §6). La UI ofrece archivar en vez de borrar.
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercise.id),
    orderIndex: integer('order_index').notNull(),
    supersetGroup: integer('superset_group'),
    restSec: integer('rest_sec'),
    warmupRestSec: integer('warmup_rest_sec'),
  },
  (t) => [
    index('idx_routine_exercise_day').on(t.dayId),
    index('idx_routine_exercise_exercise').on(t.exerciseId),
  ],
)

export const routineSet = sqliteTable(
  'routine_set',
  {
    id: id(),
    routineExerciseId: integer('routine_exercise_id')
      .notNull()
      .references(() => routineExercise.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull(),
    kind: text('kind', { enum: SET_KINDS }).notNull().default('normal'),
    repsMin: integer('reps_min'),
    repsMax: integer('reps_max'),
    targetRpe: real('target_rpe'),
  },
  (t) => [index('idx_routine_set_exercise').on(t.routineExerciseId)],
)

export const session = sqliteTable(
  'session',
  {
    id: id(),
    routineDayId: integer('routine_day_id').references(() => routineDay.id, {
      onDelete: 'set null',
    }),
    name: text('name'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    pausedMs: integer('paused_ms').notNull().default(0),
    // Pausa abierta (epoch ms) o null. El acumulado vive en `pausedMs`: al reanudar se suma y
    // esta vuelve a null, así el cronómetro se deriva del reloj sin correr nada (plan §2.6).
    pausedAt: integer('paused_at'),
    note: text('note'),
    restEndsAt: integer('rest_ends_at'),
  },
  (t) => [index('idx_session_started').on(t.startedAt)],
)

export const sessionExercise = sqliteTable(
  'session_exercise',
  {
    id: id(),
    sessionId: integer('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    // no action, no restrict: RESTRICT ignora PRAGMA defer_foreign_keys y rompería el restore de
    // la Fase 1 (plan §6). La UI ofrece archivar en vez de borrar.
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercise.id),
    orderIndex: integer('order_index').notNull(),
    supersetGroup: integer('superset_group'),
    // El descanso que pedía la rutina para este ejercicio, copiado al pre-cargar el día (D07). En la
    // fila y no leído de `routine_exercise`: la rutina se puede editar (o borrar) mientras entrenás y
    // el descanso no puede cambiar abajo del entrenamiento. `null` = el del ejercicio o el de ajustes.
    restSec: integer('rest_sec'),
    note: text('note'),
    feedback: text('feedback', { mode: 'json' }).$type<Feedback>(),
    /** Por qué se sugirió el peso que quedó en `set_entry.suggested_weight_g` de la primera serie.
     *  Se escribe junto con él y no se recalcula: la sugerencia es de ese día. */
    suggestedReason: text('suggested_reason', { enum: SUGGESTED_REASONS }),
  },
  (t) => [
    index('idx_session_exercise_session').on(t.sessionId),
    index('idx_session_exercise_exercise').on(t.exerciseId),
  ],
)

export const setEntry = sqliteTable(
  'set_entry',
  {
    id: id(),
    sessionExerciseId: integer('session_exercise_id')
      .notNull()
      .references(() => sessionExercise.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull(),
    kind: text('kind', { enum: SET_KINDS }).notNull().default('normal'),
    weightG: integer('weight_g'),
    reps: integer('reps'),
    // Lo que la rutina pedía para esta serie, copiado al pre-cargar el día (D06). Se guarda en la
    // fila y no se lee de `routine_set`: la rutina se puede editar (o borrar) después, y el
    // historial tiene que seguir diciendo qué se pedía el día que se entrenó.
    targetRepsMin: integer('target_reps_min'),
    targetRepsMax: integer('target_reps_max'),
    durationMs: integer('duration_ms'),
    distanceMm: integer('distance_mm'),
    rpe: real('rpe'),
    rir: integer('rir'),
    side: text('side', { enum: ['left', 'right'] }),
    parentSetId: integer('parent_set_id').references((): AnySQLiteColumn => setEntry.id, {
      onDelete: 'set null',
    }),
    suggestedWeightG: integer('suggested_weight_g'),
    isPr: integer('is_pr', { mode: 'boolean' }).notNull().default(false),
    completedAt: integer('completed_at'),
    note: text('note'),
  },
  (t) => [
    index('idx_set_entry_session_exercise').on(t.sessionExerciseId),
    index('idx_set_entry_completed').on(t.completedAt),
  ],
)

export const bodyMetric = sqliteTable(
  'body_metric',
  {
    id: id(),
    kind: text('kind').notNull(),
    value: integer('value').notNull(),
    measuredAt: integer('measured_at').notNull(),
  },
  (t) => [index('idx_body_metric_kind_at').on(t.kind, t.measuredAt)],
)

export const personalRecord = sqliteTable(
  'personal_record',
  {
    id: id(),
    // no action, no restrict: RESTRICT ignora PRAGMA defer_foreign_keys y rompería el restore de
    // la Fase 1 (plan §6). La UI ofrece archivar en vez de borrar.
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercise.id),
    kind: text('kind').notNull(),
    valueG: integer('value_g'),
    reps: integer('reps'),
    setEntryId: integer('set_entry_id')
      .notNull()
      .references(() => setEntry.id, { onDelete: 'cascade' }),
    achievedAt: integer('achieved_at').notNull(),
  },
  (t) => [index('idx_personal_record_exercise_kind').on(t.exerciseId, t.kind)],
)

/** Sets that count for volume and PRs. Every stats query reads this, never set_entry. */
export const vWorkSet = sqliteView('v_work_set').as((qb) =>
  qb
    .select()
    .from(setEntry)
    .where(and(ne(setEntry.kind, 'warmup'), isNotNull(setEntry.completedAt))),
)
