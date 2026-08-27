import { expect, test } from 'bun:test'
import { MAX_PARTICLES, particles } from './confetti'

test('particles is deterministic for a given seed', () => {
  expect(particles(7, 12)).toEqual(particles(7, 12))
})

test('particles changes with the seed', () => {
  expect(particles(7, 12)).not.toEqual(particles(8, 12))
})

test('particles caps the count and never goes negative', () => {
  expect(particles(1, 100)).toHaveLength(MAX_PARTICLES)
  expect(particles(1, MAX_PARTICLES)).toHaveLength(MAX_PARTICLES)
  expect(particles(1, 0)).toHaveLength(0)
  expect(particles(1, -5)).toHaveLength(0)
})

test('every particle starts near the centre, goes up and has a brand hue', () => {
  for (const p of particles(42, MAX_PARTICLES)) {
    expect(Math.abs(p.x0)).toBeLessThan(0.1)
    expect(Math.abs(p.y0)).toBeLessThan(0.1)
    // La `y` de Skia crece hacia abajo: el burst sale del semicírculo de arriba.
    expect(p.vy).toBeLessThanOrEqual(0)
    expect(p.size).toBeGreaterThan(0)
    expect(p.hue).toBeGreaterThanOrEqual(195)
    expect(p.hue).toBeLessThan(315)
  }
})

test('particles fans out to both sides', () => {
  const out = particles(3, MAX_PARTICLES)
  expect(out.some((p) => p.vx < 0)).toBe(true)
  expect(out.some((p) => p.vx > 0)).toBe(true)
})

test('particles never emits a NaN', () => {
  for (const p of particles(0, MAX_PARTICLES)) {
    for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true)
  }
})
