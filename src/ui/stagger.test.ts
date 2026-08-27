import { expect, test } from 'bun:test'
import { staggerDelay } from './stagger'

test('staggerDelay ramps by step and then flattens at the cap', () => {
  expect(staggerDelay(0)).toBe(0)
  expect(staggerDelay(1)).toBe(40)
  expect(staggerDelay(7)).toBe(280)
  expect(staggerDelay(8)).toBe(280)
  expect(staggerDelay(200)).toBe(280)
})

test('staggerDelay never goes back in time', () => {
  let prev = -1
  for (let i = 0; i < 20; i++) {
    const d = staggerDelay(i)
    expect(d).toBeGreaterThanOrEqual(prev)
    prev = d
  }
})

test('staggerDelay clamps a negative index to the first slot', () => {
  expect(staggerDelay(-3)).toBe(0)
})

test('staggerDelay honours a custom step and cap', () => {
  expect(staggerDelay(3, 60, 2)).toBe(120)
  expect(staggerDelay(1, 60, 2)).toBe(60)
})
