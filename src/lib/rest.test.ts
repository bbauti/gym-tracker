import { expect, test } from 'bun:test'
import { adjustRestEndsAt, elapsedMs, restProgress, restRemainingMs } from './rest'

const T0 = 1_800_000_000_000

test('lo que queda sale de la resta, y nunca es negativo', () => {
  expect(restRemainingMs(T0 + 90_000, T0)).toBe(90_000)
  expect(restRemainingMs(T0 + 1, T0)).toBe(1)
  expect(restRemainingMs(T0, T0)).toBe(0)
  // Volver después de tres minutos de pantalla bloqueada: 0, no un número raro.
  expect(restRemainingMs(T0 + 90_000, T0 + 180_000)).toBe(0)
})

test('la barra va de lleno a vacío y se queda ahí', () => {
  const end = T0 + 120_000
  expect(restProgress(T0, end, T0)).toBe(1)
  expect(restProgress(T0, end, T0 + 30_000)).toBe(0.75)
  expect(restProgress(T0, end, T0 + 60_000)).toBe(0.5)
  expect(restProgress(T0, end, end)).toBe(0)
  expect(restProgress(T0, end, end + 60_000)).toBe(0)
  // Antes del arranque no se pasa de 1 (reloj corrido, o el +15 s de un descanso recién creado).
  expect(restProgress(T0, end, T0 - 5_000)).toBe(1)
})

test('un descanso sin duración ya está terminado', () => {
  expect(restProgress(T0, T0, T0)).toBe(0)
  expect(restProgress(T0 + 1_000, T0, T0)).toBe(0)
})

test('+15 s suma sin techo', () => {
  expect(adjustRestEndsAt(T0 + 90_000, 15_000, T0)).toBe(T0 + 105_000)
  expect(adjustRestEndsAt(T0 + 500, 15_000, T0)).toBe(T0 + 15_500)
})

test('−15 s tiene piso en now + 1 s: tres taps seguidos no mandan el final al pasado', () => {
  let end = T0 + 20_000
  end = adjustRestEndsAt(end, -15_000, T0)
  expect(end).toBe(T0 + 5_000)
  end = adjustRestEndsAt(end, -15_000, T0)
  expect(end).toBe(T0 + 1_000)
  end = adjustRestEndsAt(end, -15_000, T0)
  expect(end).toBe(T0 + 1_000)
})

test('el cronómetro descuenta las pausas cerradas y la abierta', () => {
  // Sin pausas: reloj de pared puro.
  expect(elapsedMs(T0, 0, null, T0 + 60_000)).toBe(60_000)
  // Una pausa de 20 s ya cerrada.
  expect(elapsedMs(T0, 20_000, null, T0 + 60_000)).toBe(40_000)
  // Pausado hace 10 s: el número está congelado desde entonces.
  expect(elapsedMs(T0, 0, T0 + 50_000, T0 + 60_000)).toBe(50_000)
  expect(elapsedMs(T0, 0, T0 + 50_000, T0 + 600_000)).toBe(50_000)
  // Pausas cerradas + la abierta.
  expect(elapsedMs(T0, 20_000, T0 + 50_000, T0 + 60_000)).toBe(30_000)
})

test('el cronómetro nunca va para atrás por datos raros', () => {
  expect(elapsedMs(T0, 0, null, T0 - 5_000)).toBe(0)
  expect(elapsedMs(T0, 999_000, null, T0 + 60_000)).toBe(0)
  expect(elapsedMs(T0, 999_000, T0 + 60_000, T0 + 60_000)).toBe(0)
})

test('en pausa el número sale de pausedAt, aunque el que llama traiga un `now` viejo', () => {
  // La tab de entrenar deja de ticar al pausar (y al perder el foco): su `now` puede ser de antes
  // de la pausa. El cronómetro tiene que mostrar los 90 s entrenados igual, no los 60 que vio.
  expect(elapsedMs(T0, 0, T0 + 90_000, T0 + 60_000)).toBe(90_000)
  expect(elapsedMs(T0, 0, T0 + 90_000, T0)).toBe(90_000)
  // Y con `now` corriendo, sigue congelado en el mismo número.
  expect(elapsedMs(T0, 0, T0 + 90_000, T0 + 600_000)).toBe(90_000)
})
