import { expect, test } from 'bun:test'
import { dots, wilks2020 } from './wilks'

const kg = (n: number) => n * 1000

test('Wilks 2020 matches the published tables', () => {
  // 100 kg, total de 700 kg → 0,72937 de coeficiente.
  expect(wilks2020(kg(700), kg(100), 'm')).toBeCloseTo(510.6, 0)
  // 60 kg, total de 400 kg → 1,31903 de coeficiente.
  expect(wilks2020(kg(400), kg(60), 'f')).toBeCloseTo(527.6, 0)
})

test('DOTS matches the published tables', () => {
  // 100 kg, total de 700 kg → 0,61552 de coeficiente.
  expect(dots(kg(700), kg(100), 'm')).toBeCloseTo(430.9, 0)
  // 60 kg, total de 400 kg → 1,10855 de coeficiente.
  expect(dots(kg(400), kg(60), 'f')).toBeCloseTo(443.4, 0)
})

test('the points are linear in the total', () => {
  expect(wilks2020(kg(600), kg(90), 'm') * 2).toBeCloseTo(wilks2020(kg(1200), kg(90), 'm'), 6)
  expect(dots(kg(600), kg(90), 'f') * 2).toBeCloseTo(dots(kg(1200), kg(90), 'f'), 6)
})

test('the same total is worth less the heavier you are', () => {
  for (const sex of ['m', 'f'] as const) {
    for (let bw = 41; bw <= 150; bw++) {
      expect(wilks2020(kg(500), kg(bw), sex)).toBeLessThan(wilks2020(kg(500), kg(bw - 1), sex))
      expect(dots(kg(500), kg(bw), sex)).toBeLessThan(dots(kg(500), kg(bw - 1), sex))
    }
  }
})

test('outside the valid range the score freezes at the edge', () => {
  // Debajo de 40 kg y encima del techo el polinomio deja de tener sentido: se evalúa en el borde.
  expect(dots(kg(700), kg(250), 'm')).toBe(dots(kg(700), kg(210), 'm'))
  expect(dots(kg(700), kg(300), 'f')).toBe(dots(kg(700), kg(150), 'f'))
  expect(wilks2020(kg(300), kg(30), 'f')).toBe(wilks2020(kg(300), kg(40), 'f'))
  expect(wilks2020(kg(900), kg(240), 'm')).toBe(wilks2020(kg(900), kg(200), 'm'))
})

test('without a total or a bodyweight there is nothing to score', () => {
  expect(wilks2020(0, kg(80), 'm')).toBe(0)
  expect(dots(kg(500), 0, 'f')).toBe(0)
  expect(dots(Number.NaN, kg(80), 'm')).toBe(0)
})
