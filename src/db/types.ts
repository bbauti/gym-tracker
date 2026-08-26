import type { Metric } from './schema'

/**
 * A value the numpad can type into a set. Not a column name: the screen maps it (`weight` →
 * `weightG`, `duration` → `durationMs`) because the UI talks kilos and the db stores grams.
 */
export type Field = 'weight' | 'reps' | 'duration' | 'distance' | 'rpe' | 'rir'

/** What the numpad is pointing at. `null` (no focus) means the numpad is off screen. */
export type Focus = { setId: number; field: Field }

export type NumKey =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '.'
  | 'backspace'
  | 'minus'
  | 'plus'
  | 'plates'
  | 'next'
  | 'done'

// Module constants, not fresh arrays: `fields` is a prop of every SetRow, and a new array on every
// render would defeat the compiler's memoization of the whole list.
const WEIGHT_REPS: Field[] = ['weight', 'reps']
const REPS: Field[] = ['reps']
const DURATION: Field[] = ['duration']
const DISTANCE: Field[] = ['distance']
const DURATION_DISTANCE: Field[] = ['duration', 'distance']

/** The next-chain of a set, in order. `rpe`/`rir` are focusable by tap but never part of it. */
export function fieldsFor(metric: Metric): Field[] {
  switch (metric) {
    case 'weight_reps':
    case 'weighted_bodyweight':
      return WEIGHT_REPS
    case 'reps':
      return REPS
    case 'duration':
      return DURATION
    case 'distance':
      return DISTANCE
    case 'duration_distance':
      return DURATION_DISTANCE
  }
}
