import { expect, test } from 'bun:test'
import { sparklinePoints } from './spark'

const finite = (points: Array<[number, number]>) =>
  points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))

test('sparklinePoints spreads the series across the padded width', () => {
  const { points } = sparklinePoints([0, 5, 10], 100, 40, 2)
  expect(points.map(([x]) => x)).toEqual([2, 50, 98])
})

test('sparklinePoints puts the max at the top and the min at the bottom', () => {
  const { points, min, max } = sparklinePoints([10, 0], 100, 40, 2)
  expect(min).toBe(0)
  expect(max).toBe(10)
  expect(points[0][1]).toBe(2)
  expect(points[1][1]).toBe(38)
})

test('sparklinePoints scales to the series, not to zero', () => {
  // 100/110/120 usa el alto entero: la forma importa, no la distancia al origen.
  const { points } = sparklinePoints([100, 110, 120], 100, 40, 0)
  expect(points.map(([, y]) => y)).toEqual([40, 20, 0])
})

test('sparklinePoints draws a flat series down the middle instead of NaN', () => {
  const { points, min, max } = sparklinePoints([7, 7, 7], 100, 40, 2)
  expect(min).toBe(7)
  expect(max).toBe(7)
  expect(points.map(([, y]) => y)).toEqual([20, 20, 20])
  expect(finite(points)).toBe(true)
})

test('sparklinePoints centres a single value instead of dividing by zero', () => {
  const { points } = sparklinePoints([42], 100, 40, 2)
  expect(points).toEqual([[50, 20]])
  expect(finite(points)).toBe(true)
})

test('sparklinePoints returns nothing for an empty series', () => {
  expect(sparklinePoints([], 100, 40)).toEqual({ max: 0, min: 0, points: [] })
})

test('sparklinePoints survives a canvas smaller than its own padding', () => {
  const { points } = sparklinePoints([1, 2, 3], 2, 2, 8)
  expect(points.map(([x]) => x)).toEqual([8, 8, 8])
  expect(finite(points)).toBe(true)
})
