import { expect, test } from 'bun:test'
import { type IntervalConfig, PREP_MS, phaseAt } from './intervals'

const T0 = 1_800_000_000_000
/** 3 s de preparación, 30 de trabajo, 15 de descanso, 3 rondas. */
const C: IntervalConfig = { prepMs: PREP_MS, restMs: 15_000, rounds: 3, workMs: 30_000 }
const at = (ms: number) => phaseAt(C, T0, T0 + ms)

test('la preparación es la primera fase y cuenta 3-2-1', () => {
  expect(at(0)).toEqual({
    phase: 'prep',
    phaseEndsAt: T0 + 3_000,
    remainingMs: 3_000,
    round: 1,
    totalMs: 3_000,
  })
  expect(at(2_999).remainingMs).toBe(1)
  // Un reloj corrido para atrás no da una fase negativa.
  expect(phaseAt(C, T0, T0 - 60_000).phase).toBe('prep')
})

test('cada borde cae en la fase siguiente, no en la que termina', () => {
  expect(at(3_000)).toEqual({
    phase: 'work',
    phaseEndsAt: T0 + 33_000,
    remainingMs: 30_000,
    round: 1,
    totalMs: 30_000,
  })
  expect(at(32_999).phase).toBe('work')
  // Fin del trabajo de la ronda 1: el descanso lleva el número de la ronda que se hizo.
  expect(at(33_000)).toEqual({
    phase: 'rest',
    phaseEndsAt: T0 + 48_000,
    remainingMs: 15_000,
    round: 1,
    totalMs: 15_000,
  })
  expect(at(48_000).phase).toBe('work')
  expect(at(48_000).round).toBe(2)
})

test('la última ronda no tiene descanso: termina al terminar de trabajar', () => {
  // prep 3 + (30 + 15) × 2 + 30 = 123 s.
  expect(at(122_999)).toEqual({
    phase: 'work',
    phaseEndsAt: T0 + 123_000,
    remainingMs: 1,
    round: 3,
    totalMs: 30_000,
  })
  expect(at(123_000)).toEqual({
    phase: 'done',
    phaseEndsAt: T0 + 123_000,
    remainingMs: 0,
    round: 3,
    totalMs: 0,
  })
  // Y se queda terminado para siempre.
  expect(at(10 * 60_000).phase).toBe('done')
})

test('una sola ronda es preparación y trabajo', () => {
  const one: IntervalConfig = { ...C, rounds: 1 }
  expect(phaseAt(one, T0, T0 + 3_000).phase).toBe('work')
  expect(phaseAt(one, T0, T0 + 32_999).phase).toBe('work')
  expect(phaseAt(one, T0, T0 + 33_000).phase).toBe('done')
})

test('sin descanso las rondas se encadenan', () => {
  const nonstop: IntervalConfig = { ...C, restMs: 0 }
  expect(phaseAt(nonstop, T0, T0 + 33_000)).toEqual({
    phase: 'work',
    phaseEndsAt: T0 + 63_000,
    remainingMs: 30_000,
    round: 2,
    totalMs: 30_000,
  })
  expect(phaseAt(nonstop, T0, T0 + 93_000).phase).toBe('done')
})

test('sin preparación arranca trabajando', () => {
  const straight: IntervalConfig = { ...C, prepMs: 0 }
  expect(phaseAt(straight, T0, T0).phase).toBe('work')
  expect(phaseAt(straight, T0, T0).round).toBe(1)
})

test('una configuración imposible ya está terminada, no se cuelga', () => {
  expect(phaseAt({ ...C, rounds: 0 }, T0, T0).phase).toBe('done')
  expect(phaseAt({ ...C, workMs: 0 }, T0, T0 + 60_000).phase).toBe('done')
  expect(phaseAt({ ...C, rounds: 0 }, T0, T0).round).toBe(1)
})
