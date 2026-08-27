import { expect, test } from 'bun:test'
import { concentric } from './shape'

test('concentric subtracts the inset from the outer radius', () => {
  expect(concentric(28, 8)).toBe(20)
  expect(concentric(20, 4)).toBe(16)
})

test('concentric floors at the smallest radius instead of going square', () => {
  expect(concentric(16, 16)).toBe(6)
  expect(concentric(12, 40)).toBe(6)
})
