/**
 * Records (H01–H04): pure, no db, integer grams.
 *
 * A record is a *strict* improvement over what came before. Ties never celebrate: repeating last
 * week's best set is the normal case, and a badge that lights up every session stops meaning
 * anything (§7.5 — delight is inversely proportional to frequency).
 *
 * Warm-ups are not results. They never make a record and they never raise the bar for the sets that
 * follow — the db side reads `v_work_set`, which already filters them out (trampa #2), and these
 * functions filter again so a caller that passes raw rows cannot get it wrong.
 */

export type PrKind = 'weight' | 'reps_at_weight' | 'volume' | 'e1rm'

/**
 * H04. Epley: `w × (1 + reps/30)`, textual. Note it does not collapse to `w` at one rep (that is
 * the `(reps - 1)/30` variant): the number is a comparable index, and mixing variants would move
 * every past record.
 *
 * The formula is a *stored setting* (`settings.e1rm_formula`), never a constant baked in here:
 * switching it silently would rewrite every past record without the user asking (trampa #4). Adding
 * a second one means adding a branch here AND replaying history with `recomputeExercisePrs`, so an
 * unknown name throws instead of falling back to Epley.
 */
export function e1rmG(weightG: number, reps: number, formula: string): number {
  if (formula !== 'epley') throw new Error(`unknown e1rm formula: ${formula}`)
  if (reps < 1) throw new Error(`e1rm needs reps >= 1, got ${reps}`)
  return Math.round(weightG * (1 + reps / 30))
}

/** The three columns a record cares about, straight off `set_entry` / `v_work_set`. */
export type SetFacts = { weightG: number | null; reps: number | null; kind: string }

/**
 * The bar to beat, over the working sets that came before.
 *
 * `repsAtWeight` is keyed by grams, with bodyweight (no weight typed) living under `0`: more
 * pull-ups than last time is a record too.
 */
export type Bests = {
  weightG: number
  /** weightG → best reps at exactly that weight */
  repsAtWeight: Map<number, number>
  volumeG: number
  e1rmG: number
}

/** A set that carries no result (no reps, or a duration/distance row) can neither set nor raise a best. */
function counts(set: SetFacts): boolean {
  return set.kind !== 'warmup' && (set.reps ?? 0) > 0
}

export function emptyBests(): Bests {
  return { e1rmG: 0, repsAtWeight: new Map(), volumeG: 0, weightG: 0 }
}

/**
 * Folds one set into the running bests, in place. `bestsOf` is this in a loop; the db side needs the
 * step on its own to replay a whole exercise in one pass (`recomputeExercisePrs`) without the bar
 * being computed by two different pieces of code.
 */
export function absorb(best: Bests, set: SetFacts, formula: string): Bests {
  if (!counts(set)) return best
  const reps = set.reps as number
  const weightG = set.weightG ?? 0
  if (reps > (best.repsAtWeight.get(weightG) ?? 0)) best.repsAtWeight.set(weightG, reps)
  if (weightG <= 0) return best
  if (weightG > best.weightG) best.weightG = weightG
  if (weightG * reps > best.volumeG) best.volumeG = weightG * reps
  const e1rm = e1rmG(weightG, reps, formula)
  if (e1rm > best.e1rmG) best.e1rmG = e1rm
  return best
}

export function bestsOf(sets: SetFacts[], formula: string): Bests {
  const best = emptyBests()
  for (const set of sets) absorb(best, set, formula)
  return best
}

/**
 * Which records this set just broke. Empty is the normal answer.
 *
 * `reps_at_weight` only fires at a weight that is already in the history: the first set at 82,5 kg
 * is not "more reps than ever at 82,5 kg", it is just the first time — and if that weight is also
 * heavier than anything before, `weight` already says so.
 *
 * `formula` defaults to Epley so the two-argument call in the contract keeps working; the db side
 * always passes `settings.e1rmFormula` (trampa #4).
 */
export function detectPrs(set: SetFacts, prior: Bests, formula = 'epley'): PrKind[] {
  if (!counts(set)) return []
  const reps = set.reps as number
  const weightG = set.weightG ?? 0
  const kinds: PrKind[] = []

  // `prior.weightG` starts at 0 and only grows, so this is also the "and it was a real load" check.
  if (weightG > prior.weightG) kinds.push('weight')
  // `Infinity` when the history has never seen this exact weight: nothing to beat yet.
  if (reps > (prior.repsAtWeight.get(weightG) ?? Number.POSITIVE_INFINITY))
    kinds.push('reps_at_weight')
  if (weightG > 0) {
    if (weightG * reps > prior.volumeG) kinds.push('volume')
    if (e1rmG(weightG, reps, formula) > prior.e1rmG) kinds.push('e1rm')
  }
  return kinds
}
