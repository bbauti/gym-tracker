import { expect, test } from 'bun:test'
import { DEFAULT_BAR_G, DEFAULT_PLATES_G, nearestLoadable, platesFor } from './plates'

const P = DEFAULT_PLATES_G
const B = DEFAULT_BAR_G
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

test('the usual loads come out as the plates you would actually grab', () => {
  expect(platesFor(100_000, B, P)).toEqual({ perSide: [25_000, 15_000], achievedG: 100_000 })
  expect(platesFor(60_000, B, P)).toEqual({ perSide: [20_000], achievedG: 60_000 })
  expect(platesFor(22_500, B, P)).toEqual({ perSide: [1_250], achievedG: 22_500 })
  expect(platesFor(140_000, B, P)).toEqual({
    perSide: [25_000, 25_000, 10_000],
    achievedG: 140_000,
  })
})

test('an exact loading beats a greedy one', () => {
  // Greedy takes the 1.25 and stalls with 0.25 left over: 21.5 kg instead of the 23 kg that
  // three 0.5s a side load exactly.
  expect(platesFor(23_000, B, P)).toEqual({ perSide: [500, 500, 500], achievedG: 23_000 })
  expect(nearestLoadable(23_000, B, P)).toBe(23_000)
})

test('under the bar there is nothing to load', () => {
  expect(platesFor(15_000, B, P)).toBeNull()
  expect(platesFor(B, B, P)).toEqual({ perSide: [], achievedG: B })
  expect(nearestLoadable(15_000, B, P)).toBe(B)
})

test('an unloadable target rounds down, and never over the target', () => {
  expect(platesFor(20_400, B, P)).toEqual({ perSide: [], achievedG: B })
  expect(platesFor(20_900, B, P)).toEqual({ perSide: [], achievedG: B })
  for (let g = B; g <= 300_000; g += 100) {
    const loaded = platesFor(g, B, P)
    if (!loaded) throw new Error(`no loading for ${g}`)
    expect(loaded.achievedG).toBeLessThanOrEqual(g)
    expect(loaded.achievedG).toBe(B + 2 * sum(loaded.perSide))
  }
})

test('nearestLoadable snaps to the closest bar, up or down, and ties go light', () => {
  expect(nearestLoadable(20_400, B, P)).toBe(B) // 200 g a side down vs 300 g up
  expect(nearestLoadable(20_600, B, P)).toBe(21_000) // 300 g down vs 200 g up
  expect(nearestLoadable(20_500, B, P)).toBe(B) // 250 g either way
  expect(nearestLoadable(99_000, B, P)).toBe(99_000)
})

test('whatever nearestLoadable returns can actually be loaded', () => {
  for (let g = B; g <= 300_000; g += 137) {
    const near = nearestLoadable(g, B, P)
    const down = platesFor(g, B, P)?.achievedG ?? B
    expect(platesFor(near, B, P)?.achievedG).toBe(near)
    expect(Math.abs(near - g)).toBeLessThanOrEqual(Math.abs(down - g))
  }
})

test('no plates, weird plates', () => {
  expect(platesFor(100_000, B, [])).toEqual({ perSide: [], achievedG: B })
  expect(nearestLoadable(100_000, B, [])).toBe(B)
  // 40 kg a side with nothing but 25s: one plate, and 30 kg of the target left on the floor.
  expect(platesFor(100_000, B, [0, -5_000, 25_000])).toEqual({
    perSide: [25_000],
    achievedG: 70_000,
  })
})

test('an lb plate set (coprime grams, so the grid is useless) still answers fast and sanely', () => {
  const lb = [20_411, 15_876, 11_340, 4_536, 2_268, 1_134]
  const bar = 20_411
  const started = Date.now()
  const loaded = platesFor(102_058, bar, lb)
  if (!loaded) throw new Error('no loading')
  expect(loaded.achievedG).toBeLessThanOrEqual(102_058)
  expect(loaded.achievedG).toBe(bar + 2 * sum(loaded.perSide))
  expect(nearestLoadable(102_058, bar, lb)).toBeGreaterThan(bar)
  expect(Date.now() - started).toBeLessThan(500)
})
