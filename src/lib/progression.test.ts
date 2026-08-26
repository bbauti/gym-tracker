import { expect, test } from 'bun:test'
import type { Muscle } from '@/db/schema'
import {
  DEFAULT_LANDMARKS,
  DELOAD_DAYS,
  type DeloadInput,
  deloadAdvice,
  detectStall,
  type Feedback,
  type LoadEntry,
  landmarkZone,
  muscleLoad,
  type SessionSnapshot,
  type SuggestOptions,
  suggest,
  type WorkSet,
} from './progression'

const DAY = 86_400_000
const INC = 2_500

function set(weightG: number | null, reps: number | null, extra: Partial<WorkSet> = {}): WorkSet {
  return { rir: null, rpe: null, targetRepsMax: null, targetRepsMin: null, weightG, reps, ...extra }
}

function session(at: number, sets: WorkSet[], feedback: Feedback | null = null): SessionSnapshot {
  return { at, feedback, sets }
}

const opts = (extra: Partial<SuggestOptions> = {}): SuggestOptions => ({
  deload: false,
  incrementG: INC,
  rpeMode: 'rpe',
  ...extra,
})

test('no history suggests nothing at all', () => {
  expect(suggest([], opts())).toEqual({ reason: 'none', weightG: null })
  // Una sesión de peso corporal tampoco da un peso que ofrecer.
  expect(suggest([session(0, [set(null, 12)])], opts())).toEqual({ reason: 'none', weightG: null })
})

test('one session with nothing to compare against repeats the top weight', () => {
  expect(suggest([session(0, [set(60_000, 8), set(60_000, 7)])], opts())).toEqual({
    reason: 'repeat',
    weightG: 60_000,
  })
})

test('linear progression without targets needs last time as the bar', () => {
  const history = [session(2 * DAY, [set(60_000, 8)]), session(0, [set(60_000, 8)])]
  expect(suggest(history, opts())).toEqual({ reason: 'linear', weightG: 62_500 })

  // Menos repeticiones al mismo peso: no se sube nada.
  expect(
    suggest([session(2 * DAY, [set(60_000, 6)]), session(0, [set(60_000, 8)])], opts()),
  ).toEqual({ reason: 'repeat', weightG: 60_000 })

  // Bajar de peso tampoco es progresar, por más repeticiones que hayas hecho.
  expect(
    suggest([session(2 * DAY, [set(50_000, 12)]), session(0, [set(60_000, 8)])], opts()),
  ).toEqual({ reason: 'repeat', weightG: 50_000 })
})

test('a single target counts as linear when every set reaches it', () => {
  const sets = [set(80_000, 5), set(80_000, 5)]
  expect(suggest([session(0, sets)], opts({ targetRepsMin: 5 }))).toEqual({
    reason: 'linear',
    weightG: 82_500,
  })
})

test('double progression only adds weight at the top of the range', () => {
  const top = [set(60_000, 12), set(60_000, 12)]
  expect(suggest([session(0, top)], opts({ targetRepsMax: 12, targetRepsMin: 8 }))).toEqual({
    reason: 'double',
    weightG: 62_500,
  })

  // Adentro del rango: mismo peso, y lo que sube son las repeticiones.
  const inside = [set(60_000, 12), set(60_000, 10)]
  expect(suggest([session(0, inside)], opts({ targetRepsMax: 12, targetRepsMin: 8 }))).toEqual({
    reason: 'double',
    weightG: 60_000,
  })
})

test('the range of the previous session survives when nobody passes one', () => {
  const sets = [set(60_000, 12, { targetRepsMax: 12, targetRepsMin: 8 })]
  expect(suggest([session(0, sets)], opts())).toEqual({ reason: 'double', weightG: 62_500 })
})

test('RPE autoregulation moves two increments up and one nowhere', () => {
  const easy = [set(60_000, 8, { rpe: 6 }), set(60_000, 8, { rpe: 6.5 })]
  expect(suggest([session(0, easy)], opts())).toEqual({ reason: 'rpe_easy', weightG: 65_000 })

  // RIR es la misma escala dada vuelta: 4 en la recámara son 6 de RPE.
  const rir = [set(60_000, 8, { rir: 4 })]
  expect(suggest([session(0, rir)], opts({ rpeMode: 'rir' }))).toEqual({
    reason: 'rpe_easy',
    weightG: 65_000,
  })

  // Con un objetivo más bajo, ese mismo 6 ya no sobra.
  expect(suggest([session(0, easy)], opts({ targetRpe: 7 }))).toEqual({
    reason: 'repeat',
    weightG: 60_000,
  })

  const hard = [set(60_000, 5, { rpe: 10 }), set(60_000, 5, { rpe: 9 })]
  expect(suggest([session(0, hard)], opts())).toEqual({ reason: 'rpe_hard', weightG: 60_000 })

  // Con el esfuerzo apagado en ajustes, el RPE anotado no manda nada.
  expect(suggest([session(0, easy)], opts({ rpeMode: 'none' }))).toEqual({
    reason: 'repeat',
    weightG: 60_000,
  })
})

test('missing the target reps is a hard session even without RPE', () => {
  const sets = [set(60_000, 12), set(60_000, 6)]
  expect(suggest([session(0, sets)], opts({ targetRepsMax: 12, targetRepsMin: 8 }))).toEqual({
    reason: 'rpe_hard',
    weightG: 60_000,
  })
})

test('feedback overrides a weight bump', () => {
  const sets = [set(60_000, 12)]
  const range = opts({ targetRepsMax: 12, targetRepsMin: 8 })
  expect(suggest([session(0, sets, { difficulty: 3 })], range)).toEqual({
    reason: 'feedback_hard',
    weightG: 60_000,
  })
  expect(suggest([session(0, sets, { pain: 1 })], range)).toEqual({
    reason: 'feedback_hard',
    weightG: 60_000,
  })
  // Un buen bombeo no frena nada.
  expect(suggest([session(0, sets, { pump: 3 })], range)).toEqual({
    reason: 'double',
    weightG: 62_500,
  })
})

test('a stall backs off 10%, and a deload beats everything', () => {
  const flat = [
    session(4 * DAY, [set(60_000, 5)]),
    session(2 * DAY, [set(60_000, 5)]),
    session(0, [set(60_000, 5)]),
  ]
  expect(detectStall(flat)).toBe(true)
  // 60 × 0,9 = 54 kg, redondeado al múltiplo de 2,5 más cercano.
  expect(suggest(flat, opts())).toEqual({ reason: 'stall', weightG: 55_000 })

  // El deload manda incluso sobre el estancamiento: 60 × 0,6 = 36 kg.
  expect(suggest(flat, opts({ deload: true }))).toEqual({ reason: 'deload', weightG: 35_000 })
})

test('the stall window is exactly n sessions and an improvement clears it', () => {
  const flat = (at: number, reps: number) => session(at, [set(100_000, reps)])
  expect(detectStall([flat(2 * DAY, 5), flat(0, 5)])).toBe(false) // faltan sesiones

  // La más nueva superó el 1RM estimado de la más vieja de la ventana.
  expect(detectStall([flat(4 * DAY, 6), flat(2 * DAY, 5), flat(0, 5)])).toBe(false)
  // Y la del medio también alcanza para no estar estancado.
  expect(detectStall([flat(4 * DAY, 5), flat(2 * DAY, 6), flat(0, 5)])).toBe(false)
  expect(detectStall([flat(4 * DAY, 5), flat(2 * DAY, 5), flat(0, 5)])).toBe(true)

  // La cuarta sesión queda fuera de la ventana de 3.
  expect(detectStall([flat(6 * DAY, 5), flat(4 * DAY, 5), flat(2 * DAY, 5), flat(0, 8)])).toBe(true)
  // Sin peso no hay veredicto: comparar ceros diría que todo peso corporal está estancado.
  const bodyweight = [
    session(4 * DAY, [set(null, 10)]),
    session(2 * DAY, [set(null, 10)]),
    session(0, [set(null, 10)]),
  ]
  expect(detectStall(bodyweight)).toBe(false)
})

const NOW = new Date(2026, 7, 26, 10).getTime()
const deload = (extra: Partial<DeloadInput> = {}): DeloadInput => ({
  avgRpe: null,
  deloadDismissedAt: null,
  deloadEndedAt: null,
  deloadUntil: null,
  exercisesTrained: 0,
  now: NOW,
  rpeSessions: 0,
  stalledShare: 0,
  ...extra,
})

test('deload advice needs half the exercises stalled, or five hard sessions', () => {
  expect(deloadAdvice(deload({ exercisesTrained: 4, stalledShare: 0.5 }))).toEqual({
    active: false,
    advise: true,
    reason: 'stall',
    until: null,
  })
  // Dos ejercicios estancados de dos no dicen nada: es media semana de datos.
  expect(deloadAdvice(deload({ exercisesTrained: 2, stalledShare: 1 })).advise).toBe(false)
  expect(deloadAdvice(deload({ exercisesTrained: 4, stalledShare: 0.25 })).advise).toBe(false)

  expect(deloadAdvice(deload({ avgRpe: 9.2, rpeSessions: 5 })).reason).toBe('rpe')
  expect(deloadAdvice(deload({ avgRpe: 9.2, rpeSessions: 4 })).advise).toBe(false)
  expect(deloadAdvice(deload({ avgRpe: 8.5, rpeSessions: 6 })).advise).toBe(false)
})

test('deload advice stays quiet while it is running and for weeks after', () => {
  const stalled = { exercisesTrained: 4, stalledShare: 1 }
  const until = NOW + 3 * DAY

  expect(deloadAdvice(deload({ ...stalled, deloadUntil: until }))).toEqual({
    active: true,
    advise: false,
    reason: null,
    until,
  })
  // Vencerse solo cuenta como terminarlo: apagado, pero con las mismas tres semanas de silencio.
  expect(deloadAdvice(deload({ ...stalled, deloadUntil: NOW - DAY })).advise).toBe(false)
  expect(deloadAdvice(deload({ ...stalled, deloadUntil: NOW - 22 * DAY })).advise).toBe(true)

  // "Ahora no": dos semanas de silencio.
  expect(deloadAdvice(deload({ ...stalled, deloadDismissedAt: NOW - 13 * DAY })).advise).toBe(false)
  expect(deloadAdvice(deload({ ...stalled, deloadDismissedAt: NOW - 15 * DAY })).advise).toBe(true)

  // Recién terminado: tres semanas.
  expect(deloadAdvice(deload({ ...stalled, deloadEndedAt: NOW - 20 * DAY })).advise).toBe(false)
  expect(deloadAdvice(deload({ ...stalled, deloadEndedAt: NOW - 22 * DAY })).advise).toBe(true)

  expect(DELOAD_DAYS).toBe(7)
})

test('landmark zones read the week from below MEV to over MRV', () => {
  const lm = { mav: 14, mev: 8, mrv: 22 }
  expect(landmarkZone(0, lm)).toBe('below')
  expect(landmarkZone(7.5, lm)).toBe('below')
  expect(landmarkZone(8, lm)).toBe('mev')
  expect(landmarkZone(13.5, lm)).toBe('mev')
  expect(landmarkZone(14, lm)).toBe('mav')
  expect(landmarkZone(22, lm)).toBe('mrv')
  expect(landmarkZone(23, lm)).toBe('over')

  // Con MEV 0 (abdominales), cero series sigue siendo "no lo entrenaste". Con MAV 0 también.
  expect(landmarkZone(0, DEFAULT_LANDMARKS.abs)).toBe('below')
  expect(landmarkZone(0, { mav: 0, mev: 0, mrv: 10 })).toBe('below')
  expect(landmarkZone(1, DEFAULT_LANDMARKS.abs)).toBe('mev')
  // `full_body` no es un músculo: nunca sale de `below`.
  expect(landmarkZone(30, DEFAULT_LANDMARKS.full_body)).toBe('below')
  expect(DEFAULT_LANDMARKS.chest).toEqual({ mav: 14, mev: 8, mrv: 22 })
})

test('muscle load decays by half every two days and tops out at one', () => {
  const now = NOW
  const load = (entries: LoadEntry[], muscle: Muscle) => muscleLoad(entries, now)[muscle] ?? 0

  expect(load([{ at: now, muscle: 'chest', weight: 1 }], 'chest')).toBeCloseTo(0.125, 6)
  // 48 h después vale la mitad.
  expect(load([{ at: now - 2 * DAY, muscle: 'chest', weight: 1 }], 'chest')).toBeCloseTo(0.0625, 6)
  // Un secundario pesa medio.
  expect(load([{ at: now, muscle: 'triceps', weight: 0.5 }], 'triceps')).toBeCloseTo(0.0625, 6)
  // Ocho series de hoy llenan la barra, y veinte no la pasan.
  const many = Array.from({ length: 20 }, () => ({ at: now, muscle: 'quads' as const, weight: 1 }))
  expect(load(many, 'quads')).toBe(1)
  // Un músculo que no aparece no está en el resultado: el que dibuja pone el cero.
  expect(muscleLoad([], now)).toEqual({})
})
