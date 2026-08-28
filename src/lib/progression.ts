import type { Feedback, Muscle, Reason } from '@/db/schema'
import { e1rmG } from './prs'
import { roundToIncrement } from './units'

/**
 * Progresión (E01–E09): puro, sin db y sin React. Todo lo que entra acá son series de TRABAJO
 * (`v_work_set`) — una entrada en calor no sugiere, no estanca y no carga un músculo (trampa #2).
 *
 * Nada de esto escribe: la app sugiere, nunca aplica (§2.2). La salida de `suggest` termina en
 * `set_entry.suggested_weight_g` / `suggested_reps` como texto fantasma, y se vuelve dato recién
 * cuando el usuario tilda la serie.
 */

export type { Feedback, Reason }

export type WorkSet = {
  weightG: number | null
  reps: number | null
  rpe: number | null
  rir: number | null
  targetRepsMin: number | null
  targetRepsMax: number | null
}

/** Una sesión pasada del ejercicio, ya filtrada a series de trabajo. Más nueva primero. */
export type SessionSnapshot = { at: number; sets: WorkSet[]; feedback: Feedback | null }

export type SuggestOptions = {
  incrementG: number
  targetRepsMin?: number | null
  targetRepsMax?: number | null
  targetRpe?: number | null
  deload: boolean
  rpeMode: 'rpe' | 'rir' | 'none'
}

export type Suggestion = { weightG: number | null; reps: number | null; reason: Reason }

/** E07. Volumen semanal por músculo, en series duras. */
export type Landmark = { mev: number; mav: number; mrv: number }
export type Zone = 'below' | 'mev' | 'mav' | 'mrv' | 'over'

/** RPE objetivo cuando la rutina no pide uno: dejar 2 en la recámara. */
const DEFAULT_TARGET_RPE = 8
/** Debajo de esto la serie sobró y se suben dos escalones de una (E04). */
const EASY_MARGIN = 1.5
/** Arriba de esto se repite peso, venga de donde venga el número. */
const HARD_RPE = 9.5
/** Cuántas sesiones mira `detectStall` (E05). */
const STALL_WINDOW = 3
const DELOAD_FACTOR = 0.6
const STALL_FACTOR = 0.9

/** El peso más pesado de la sesión, que es contra el que se progresa. `null` si no hubo ninguno. */
function topWeightG(snapshot: SessionSnapshot | undefined): number | null {
  if (!snapshot) return null
  let top: number | null = null
  for (const s of snapshot.sets) {
    if (s.weightG !== null && s.weightG > 0 && (top === null || s.weightG > top)) top = s.weightG
  }
  return top
}

/**
 * Esfuerzo de una serie en escala RPE. El RIR es la misma escala dada vuelta (`rpe = 10 - rir`), así
 * que el modo de ajustes cambia lo que se escribe, no lo que se razona.
 */
function effort(set: WorkSet): number | null {
  if (set.rpe !== null) return set.rpe
  if (set.rir !== null) return 10 - set.rir
  return null
}

function avgEffort(snapshot: SessionSnapshot): number | null {
  let sum = 0
  let n = 0
  for (const s of snapshot.sets) {
    const e = effort(s)
    if (e !== null) {
      sum += e
      n += 1
    }
  }
  return n === 0 ? null : sum / n
}

/** El mejor 1RM estimado de la sesión. 0 si no hay ninguna serie con peso y repeticiones. */
function bestE1rmG(snapshot: SessionSnapshot): number {
  let best = 0
  for (const s of snapshot.sets) {
    if (s.weightG === null || s.weightG <= 0 || s.reps === null || s.reps < 1) continue
    // Epley fijo: `e1rmG` tira con cualquier otra fórmula y acá el número no se guarda, solo se
    // compara contra sí mismo dentro de la misma ventana.
    best = Math.max(best, e1rmG(s.weightG, s.reps, 'epley'))
  }
  return best
}

/**
 * E05. Estancado = en la ventana de `n` sesiones, ninguna de las `n - 1` más nuevas superó el mejor
 * 1RM estimado de la más vieja. Empatar es estancarse: tres semanas repitiendo el mismo top set es
 * exactamente lo que la palabra describe.
 *
 * Con menos de `n` sesiones no hay veredicto (todavía es "recién empezado"), y con la más vieja sin
 * peso tampoco: comparar ceros diría que todo peso corporal está estancado para siempre.
 */
export function detectStall(history: SessionSnapshot[], n = STALL_WINDOW): boolean {
  if (n < 2 || history.length < n) return false
  const base = bestE1rmG(history[n - 1])
  if (base <= 0) return false
  for (let i = 0; i < n - 1; i++) if (bestE1rmG(history[i]) > base) return false
  return true
}

/** Si la rutina pedía un rango y alguna serie se quedó corta del mínimo. */
function missedReps(snapshot: SessionSnapshot, targetRepsMin: number | null): boolean {
  if (targetRepsMin === null) return false
  return snapshot.sets.some((s) => s.reps !== null && s.reps < targetRepsMin)
}

/**
 * E01/E02/E04/E09: el peso y el porqué. La precedencia es la del plan y se lee de arriba abajo:
 * `deload > stall > feedback_hard > rpe_hard > rpe_easy > double/linear > repeat`.
 */
function suggestWeight(
  history: SessionSnapshot[],
  opts: SuggestOptions,
  targetRepsMin: number | null,
  targetRepsMax: number | null,
): { weightG: number | null; reason: Reason } {
  const last = history[0]
  const top = topWeightG(last)
  if (!last || top === null) return { reason: 'none', weightG: null }

  const round = (g: number) => roundToIncrement(g, opts.incrementG)
  if (opts.deload) return { reason: 'deload', weightG: round(top * DELOAD_FACTOR) }
  if (detectStall(history)) return { reason: 'stall', weightG: round(top * STALL_FACTOR) }

  // El feedback pisa cualquier "+": dolor o "durísimo" no se discuten con un promedio de RPE.
  if (last.feedback?.difficulty === 3 || last.feedback?.pain === 1)
    return { reason: 'feedback_hard', weightG: top }

  const missed = missedReps(last, targetRepsMin)
  const rpe = opts.rpeMode === 'none' ? null : avgEffort(last)

  if (missed || (rpe !== null && rpe >= HARD_RPE)) return { reason: 'rpe_hard', weightG: top }
  if (rpe !== null && rpe <= (opts.targetRpe ?? DEFAULT_TARGET_RPE) - EASY_MARGIN)
    return { reason: 'rpe_easy', weightG: round(top + 2 * opts.incrementG) }

  // E02: con rango, el peso sube recién cuando TODAS las series llegaron al tope. Si no, se repite
  // peso y lo que sube son las repeticiones — la sugerencia igual dice 'double' para que el pie de
  // la card explique por qué el número no se movió.
  if (targetRepsMax !== null) {
    const all = last.sets.every((s) => s.reps !== null && s.reps >= targetRepsMax)
    return { reason: 'double', weightG: all ? round(top + opts.incrementG) : top }
  }

  // E01 con objetivo simple: llegar al mínimo pedido en todas las series alcanza para subir.
  if (targetRepsMin !== null) {
    const all = last.sets.every((s) => s.reps !== null && s.reps >= targetRepsMin)
    if (all) return { reason: 'linear', weightG: round(top + opts.incrementG) }
    return { reason: 'repeat', weightG: top }
  }

  // E01 sin objetivo: la vara es lo que hiciste la vez pasada al mismo peso o más.
  const previous = history[1]
  const prevTop = topWeightG(previous)
  if (previous && prevTop !== null && top >= prevTop) {
    const before = Math.max(...previous.sets.map((s) => s.reps ?? 0))
    const now = Math.max(...last.sets.map((s) => s.reps ?? 0))
    if (now > 0 && now >= before) return { reason: 'linear', weightG: round(top + opts.incrementG) }
  }
  return { reason: 'repeat', weightG: top }
}

/** Los escalones del rango: mínimo, medio y tope, sin repetidos. "8–12" son 8, 10 y 12. */
function repLevels(min: number, max: number): number[] {
  return [...new Set([min, Math.floor((min + max) / 2), max])]
}

/**
 * E02 del lado de las repeticiones: el objetivo del día. Sube de a un escalón mientras el peso se
 * queda quieto y vuelve al mínimo apenas se mueve (arriba por progresión, abajo por estancamiento o
 * deload) — subir peso y reps el mismo día es subir dos veces.
 *
 * Manda la serie MÁS FLOJA de la sesión pasada: todas tienen que llegar al escalón antes de pasar al
 * que sigue, que es la misma regla con la que el peso espera al tope del rango.
 */
function suggestReps(
  last: SessionSnapshot | undefined,
  top: number | null,
  weightG: number | null,
  targetRepsMin: number | null,
  targetRepsMax: number | null,
): number | null {
  // Un objetivo de un número solo (5×5) es un rango de un escalón, no "sin rango".
  const min = targetRepsMin ?? targetRepsMax
  const max = targetRepsMax ?? targetRepsMin
  if (!last || top === null || weightG === null || min === null || max === null) return null
  if (weightG !== top) return min

  let lowest: number | null = null
  for (const s of last.sets) {
    if (s.reps !== null && (lowest === null || s.reps < lowest)) lowest = s.reps
  }
  // Una sesión anotada sin repeticiones (solo peso) no tiene escalón desde el cual seguir.
  if (lowest === null) return min
  // Con todas las series en el tope el peso ya subiría (y esto sería `min`); el `?? max` es para el
  // dato raro que se cuela igual: una serie anotada por arriba del rango, o el rango achicado ayer.
  return repLevels(min, max).find((r) => r > lowest) ?? max
}

/**
 * La sugerencia del día: cuánto peso, cuántas repeticiones y por qué.
 *
 * El objetivo de reps sale de los argumentos y, si no vienen, de lo que pedía la sesión anterior:
 * un ejercicio suelto (sin rutina) igual arrastra el rango que tenía la última vez.
 */
export function suggest(history: SessionSnapshot[], opts: SuggestOptions): Suggestion {
  const last = history[0]
  const targetRepsMin = opts.targetRepsMin ?? last?.sets[0]?.targetRepsMin ?? null
  const targetRepsMax = opts.targetRepsMax ?? last?.sets[0]?.targetRepsMax ?? null
  const weight = suggestWeight(history, opts, targetRepsMin, targetRepsMax)
  return {
    ...weight,
    reps: suggestReps(last, topWeightG(last), weight.weightG, targetRepsMin, targetRepsMax),
  }
}

const DAY_MS = 86_400_000
/** Cuántos ejercicios distintos hacen falta para que "la mitad está estancada" signifique algo. */
const DELOAD_MIN_EXERCISES = 3
const DELOAD_STALL_SHARE = 0.5
/** Sesiones con esfuerzo anotado que hacen falta para leer el promedio (E06). */
const DELOAD_MIN_RPE_SESSIONS = 5
const DELOAD_HARD_RPE = 9
export const DELOAD_DAYS = 7
/** Ventanas de silencio: descartar el consejo calla dos semanas, terminar un deload calla tres. */
const DISMISS_SILENCE_MS = 14 * DAY_MS
const AFTER_DELOAD_SILENCE_MS = 21 * DAY_MS

export type DeloadInput = {
  stalledShare: number
  exercisesTrained: number
  avgRpe: number | null
  rpeSessions: number
  deloadUntil: number | null
  deloadDismissedAt: number | null
  deloadEndedAt: number | null
  now: number
}

export type DeloadState = {
  advise: boolean
  reason: 'stall' | 'rpe' | null
  active: boolean
  until: number | null
}

/**
 * E06. Recomendar bajar una semana, o callarse.
 *
 * Se calla mucho a propósito (§7.5: la sorpresa es inversamente proporcional a la frecuencia). Una
 * tarjeta que aparece cada lunes deja de leerse, y esta se equivoca hacia el silencio: durante el
 * deload, dos semanas después de un "ahora no" y tres semanas después de que uno termine.
 */
export function deloadAdvice(input: DeloadInput): DeloadState {
  const active = input.deloadUntil !== null && input.deloadUntil > input.now
  const state = { active, until: active ? input.deloadUntil : null }
  if (active) return { ...state, advise: false, reason: null }
  if (input.deloadDismissedAt !== null && input.now - input.deloadDismissedAt < DISMISS_SILENCE_MS)
    return { ...state, advise: false, reason: null }
  // Una ventana vencida también es un final: casi nadie toca "Terminar", se le acaba el plazo. Sin
  // esto el consejo vuelve al día siguiente, porque una semana al 60% no supera ningún 1RM previo y
  // los ejercicios siguen figurando estancados.
  const endedAt = Math.max(input.deloadEndedAt ?? 0, input.deloadUntil ?? 0) || null
  if (endedAt !== null && input.now - endedAt < AFTER_DELOAD_SILENCE_MS)
    return { ...state, advise: false, reason: null }

  if (input.exercisesTrained >= DELOAD_MIN_EXERCISES && input.stalledShare >= DELOAD_STALL_SHARE)
    return { ...state, advise: true, reason: 'stall' }
  if (
    input.rpeSessions >= DELOAD_MIN_RPE_SESSIONS &&
    input.avgRpe !== null &&
    input.avgRpe >= DELOAD_HARD_RPE
  )
    return { ...state, advise: true, reason: 'rpe' }
  return { ...state, advise: false, reason: null }
}

/**
 * E07. Series duras por semana y músculo, estilo Renaissance Periodization: MEV (mínimo que hace
 * algo), MAV (donde rinde), MRV (lo máximo que se recupera). Son un punto de partida discutible a
 * propósito — `settings.volume_landmarks` los pisa por músculo.
 *
 * `full_body` va en 0/0/0: no es un músculo, es lo que se marca cuando el ejercicio no tiene uno.
 */
export const DEFAULT_LANDMARKS: Record<Muscle, Landmark> = {
  abs: { mav: 12, mev: 0, mrv: 20 },
  adductors: { mav: 8, mev: 0, mrv: 12 },
  back_lats: { mav: 16, mev: 8, mrv: 24 },
  back_upper: { mav: 16, mev: 8, mrv: 24 },
  biceps: { mav: 14, mev: 6, mrv: 20 },
  calves: { mav: 12, mev: 6, mrv: 18 },
  chest: { mav: 14, mev: 8, mrv: 22 },
  forearms: { mav: 8, mev: 2, mrv: 16 },
  full_body: { mav: 0, mev: 0, mrv: 0 },
  glutes: { mav: 12, mev: 0, mrv: 16 },
  hamstrings: { mav: 10, mev: 4, mrv: 16 },
  lower_back: { mav: 8, mev: 0, mrv: 14 },
  obliques: { mav: 8, mev: 0, mrv: 16 },
  quads: { mav: 14, mev: 8, mrv: 20 },
  shoulders_front: { mav: 8, mev: 0, mrv: 12 },
  shoulders_rear: { mav: 12, mev: 6, mrv: 20 },
  shoulders_side: { mav: 16, mev: 8, mrv: 26 },
  traps: { mav: 12, mev: 4, mrv: 20 },
  triceps: { mav: 12, mev: 6, mrv: 18 },
}

/**
 * En qué banda cae el volumen de la semana. Cero series es siempre `below`, aunque el MEV sea 0
 * (abdominales, glúteos): "no lo entrenaste" no es "estás en el mínimo".
 */
export function landmarkZone(sets: number, lm: Landmark): Zone {
  if (sets <= 0) return 'below'
  if (lm.mrv <= 0) return 'below'
  if (sets > lm.mrv) return 'over'
  if (sets >= lm.mrv) return 'mrv'
  if (sets >= lm.mav) return 'mav'
  if (sets >= lm.mev) return 'mev'
  return 'below'
}

/** Cada 48 h el peso de una serie vale la mitad. */
const LOAD_HALF_LIFE_H = 48
/** Series (con su peso 1 / 0,5) que llenan la barra. Arriba de esto el músculo dibuja "cargado". */
const LOAD_FULL = 8
const HOUR_MS = 3_600_000

export type LoadEntry = { muscle: Muscle; weight: number; at: number }

/**
 * E08. Carga reciente por músculo, 0 a 1, para el mapa de recuperación. No es fatiga medida: es
 * "cuánto y hace cuánto", con las series de hace tres días pesando un octavo de las de hoy.
 */
export function muscleLoad(entries: LoadEntry[], now: number): Partial<Record<Muscle, number>> {
  const load: Partial<Record<Muscle, number>> = {}
  for (const e of entries) {
    const ageH = Math.max(0, (now - e.at) / HOUR_MS)
    load[e.muscle] = (load[e.muscle] ?? 0) + e.weight * 0.5 ** (ageH / LOAD_HALF_LIFE_H)
  }
  for (const muscle of Object.keys(load) as Muscle[]) {
    load[muscle] = Math.min(1, Math.max(0, (load[muscle] ?? 0) / LOAD_FULL))
  }
  return load
}
