import { expect, test } from 'bun:test'
import {
  formatDistance,
  formatDuration,
  formatWeight,
  gToUnit,
  parseWeight,
  roundToIncrement,
  unitToG,
} from './units'

test('kg round-trips through integer grams', () => {
  expect(unitToG(82.5, 'kg')).toBe(82500)
  expect(unitToG(0.1, 'kg')).toBe(100)
  for (const v of [0, 2.5, 20, 60.25, 82.5, 137.75, 300]) {
    expect(gToUnit(unitToG(v, 'kg'), 'kg')).toBe(v)
  }
})

test('0.1 kg steps never accumulate float error', () => {
  let g = 0
  for (let i = 0; i < 100; i++) g += unitToG(0.1, 'kg')
  expect(g).toBe(10_000)
  expect(gToUnit(g, 'kg')).toBe(10)
})

test('lb round-trips within a gram', () => {
  for (const v of [45, 135, 225.5, 315]) {
    expect(Math.abs(gToUnit(unitToG(v, 'lb'), 'lb') - v)).toBeLessThan(0.002)
  }
})

test('formatWeight is locale aware and trims trailing zeros', () => {
  expect(formatWeight(82500, 'kg', 'es')).toBe('82,5 kg')
  expect(formatWeight(82500, 'kg', 'en')).toBe('82.5 kg')
  expect(formatWeight(82000, 'kg', 'en')).toBe('82 kg')
  expect(formatWeight(82500, 'kg', 'es', { withUnit: false })).toBe('82,5')
  expect(formatWeight(unitToG(135, 'lb'), 'lb', 'en')).toBe('135 lb')
})

test('parseWeight accepts both decimal separators and rejects garbage', () => {
  expect(parseWeight('82,5', 'kg')).toBe(82500)
  expect(parseWeight('82.5', 'kg')).toBe(82500)
  expect(parseWeight(' 82.5 ', 'kg')).toBe(82500)
  expect(parseWeight('.5', 'kg')).toBe(500)
  expect(parseWeight('135', 'lb')).toBe(61235)
  expect(parseWeight('', 'kg')).toBeNull()
  expect(parseWeight('.', 'kg')).toBeNull()
  expect(parseWeight('82.5.5', 'kg')).toBeNull()
  expect(parseWeight('-5', 'kg')).toBeNull()
  expect(parseWeight('abc', 'kg')).toBeNull()
})

test('roundToIncrement snaps to the nearest plate step', () => {
  expect(roundToIncrement(82499, 1250)).toBe(82500)
  expect(roundToIncrement(82501, 2500)).toBe(82500)
  expect(roundToIncrement(1249, 2500)).toBe(0)
  expect(roundToIncrement(1250, 2500)).toBe(2500)
  expect(roundToIncrement(82333, 0)).toBe(82333)
  expect(Number.isInteger(roundToIncrement(99999, 1250))).toBe(true)
})

test('formatDuration switches to hours only when needed', () => {
  expect(formatDuration(0)).toBe('0:00')
  expect(formatDuration(9000)).toBe('0:09')
  expect(formatDuration(90_000)).toBe('1:30')
  expect(formatDuration(599_000)).toBe('9:59')
  expect(formatDuration(3_600_000)).toBe('1:00:00')
  expect(formatDuration(3_661_000)).toBe('1:01:01')
  expect(formatDuration(-5000)).toBe('0:00')
})

test('formatDistance converts millimetres', () => {
  expect(formatDistance(5_000_000, 'km', 'en')).toBe('5 km')
  expect(formatDistance(5_000_000, 'km', 'es')).toBe('5 km')
  expect(formatDistance(1_609_344, 'mi', 'en')).toBe('1 mi')
  expect(formatDistance(2_500_000, 'km', 'es')).toBe('2,5 km')
})
