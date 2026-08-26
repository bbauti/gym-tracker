import { expect, test } from 'bun:test'
import { DEFAULT_BAR_G, DEFAULT_PLATES_G, platesFor } from './plates'
import { RAMP, warmupRamp } from './warmup'

const gym = { barG: DEFAULT_BAR_G, platesG: DEFAULT_PLATES_G }

test('the full ramp climbs to the work weight without reaching it', () => {
  expect(warmupRamp(100_000, gym)).toEqual([
    { weightG: 40_000, reps: 10 },
    { weightG: 60_000, reps: 5 },
    { weightG: 80_000, reps: 3 },
    { weightG: 90_000, reps: 1 },
  ])
})

test('fewer steps drop the middle ones, never the light first one', () => {
  expect(warmupRamp(100_000, { ...gym, steps: 3 })).toEqual([
    { weightG: 40_000, reps: 10 },
    { weightG: 80_000, reps: 3 },
    { weightG: 90_000, reps: 1 },
  ])
  expect(warmupRamp(100_000, { ...gym, steps: 2 })).toEqual([
    { weightG: 40_000, reps: 10 },
    { weightG: 90_000, reps: 1 },
  ])
})

test('steps outside the table clamp to it', () => {
  expect(warmupRamp(100_000, { ...gym, steps: 0 })).toEqual([{ weightG: 40_000, reps: 10 }])
  expect(warmupRamp(100_000, { ...gym, steps: 9 })).toEqual(warmupRamp(100_000, gym))
})

test('every weight is loadable and never under the bar', () => {
  for (let workG = DEFAULT_BAR_G; workG <= 250_000; workG += 1_250) {
    for (const step of warmupRamp(workG, gym)) {
      expect(step.weightG).toBeGreaterThanOrEqual(DEFAULT_BAR_G)
      expect(step.weightG).toBeLessThan(workG)
      expect(platesFor(step.weightG, DEFAULT_BAR_G, DEFAULT_PLATES_G)?.achievedG).toBe(step.weightG)
    }
  }
})

test('steps that collapse onto the same bar show up once', () => {
  // 40 %–90 % de 22 kg cae debajo de la barra: los cuatro pasos son la barra pelada.
  expect(warmupRamp(22_000, gym)).toEqual([{ weightG: DEFAULT_BAR_G, reps: 10 }])
})

test('the bar alone needs no warm-up', () => {
  expect(warmupRamp(DEFAULT_BAR_G, gym)).toEqual([])
  expect(warmupRamp(0, gym)).toEqual([])
})

test('the ramp goes up in weight and down in reps', () => {
  for (let i = 1; i < RAMP.length; i++) {
    expect(RAMP[i].pct).toBeGreaterThan(RAMP[i - 1].pct)
    expect(RAMP[i].reps).toBeLessThan(RAMP[i - 1].reps)
  }
})
