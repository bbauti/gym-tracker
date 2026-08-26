import { expect, test } from 'bun:test'
import { nearestSnap, project, rubberband } from './gesture'

test('rubberband is odd, monotonic and bounded by the dimension', () => {
  const d = 400
  expect(rubberband(0, d)).toBe(0)
  expect(rubberband(-120, d)).toBeCloseTo(-rubberband(120, d), 10)

  let prev = 0
  for (let x = 1; x <= 2000; x += 7) {
    const y = rubberband(x, d)
    expect(y).toBeGreaterThan(prev)
    expect(y).toBeLessThan(d)
    prev = y
  }
  expect(rubberband(1e9, d)).toBeLessThan(d)
})

test('rubberband resists harder with a lower coefficient', () => {
  expect(rubberband(200, 400, 0.3)).toBeLessThan(rubberband(200, 400, 0.55))
})

test('project returns the momentum distance', () => {
  expect(project(1000, 0.99)).toBeCloseTo(99, 10)
  expect(project(0)).toBe(0)
  expect(project(-1000, 0.99)).toBeCloseTo(-99, 10)
  expect(project(500)).toBeGreaterThan(project(100))
})

test('nearestSnap picks the closest point', () => {
  const points = [0, 0.5, 1]
  expect(nearestSnap(0.6, points)).toBe(0.5)
  expect(nearestSnap(0.9, points)).toBe(1)
  expect(nearestSnap(-10, points)).toBe(0)
  expect(nearestSnap(0.25, points)).toBe(0)
  expect(nearestSnap(42, [])).toBe(42)
})
