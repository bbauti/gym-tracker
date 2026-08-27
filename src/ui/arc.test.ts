import { expect, test } from 'bun:test'
import { ringPath, ringRadius, ringSweep } from './arc'

test('ringSweep clamps the progress into the trim range', () => {
  expect(ringSweep(0.42)).toBe(0.42)
  expect(ringSweep(-1)).toBe(0)
  expect(ringSweep(4)).toBe(1)
})

test('ringRadius leaves half the stroke inside and half outside', () => {
  expect(ringRadius(100, 8)).toBe(46)
  expect(ringRadius(220, 8)).toBe(106)
})

test('ringRadius never goes negative when the stroke eats the ring', () => {
  expect(ringRadius(8, 8)).toBe(0)
  expect(ringRadius(4, 12)).toBe(0)
})

test('ringPath starts at twelve o clock and sweeps clockwise', () => {
  const d = ringPath(100, 8)
  // Arranca arriba (centro 50, radio 46) porque el trim mide desde el inicio del contorno.
  expect(d.startsWith('M 50 4 ')).toBe(true)
  // Dos medias vueltas, las dos con flag de barrido 1 (horario).
  expect(d.match(/A 46 46 0 1 1 /g)).toHaveLength(2)
  // Y vuelve exactamente al punto de partida: el contorno cierra.
  expect(d.endsWith('A 46 46 0 1 1 50 4')).toBe(true)
})
