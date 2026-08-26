import { expect, test } from 'bun:test'
import { parseRoutineDraft } from './routineText'

const shape = (text: string) =>
  parseRoutineDraft(text)?.days.map((d) => ({
    name: d.name,
    weekIndex: d.weekIndex,
    exercises: d.exercises.map((e) => [
      e.name,
      e.sets,
      e.repsMin,
      e.repsMax,
      e.weightG ?? e.weight,
    ]),
  }))

const NOTEBOOK = `
  PPL

  Push:
  - Bench press 3x8-12 @60kg
  - Incline DB press 3 x 10
  Día 2
  1. Squat 5×5 100 kg
  Row — 4 sets 12 reps
`

test('el texto de un cuaderno: encabezados, viñetas y las cuatro formas de escribir series', () => {
  const draft = parseRoutineDraft(NOTEBOOK)
  expect(draft?.name).toBe('PPL')
  expect(draft?.weeks).toBeNull()
  expect(shape(NOTEBOOK)).toEqual([
    {
      name: 'Push',
      weekIndex: null,
      exercises: [
        ['Bench press', 3, 8, 12, 60_000],
        ['Incline DB press', 3, 10, 10, null],
      ],
    },
    {
      name: 'Día 2',
      weekIndex: null,
      exercises: [
        ['Squat', 5, 5, 5, 100_000],
        ['Row', 4, 12, 12, null],
      ],
    },
  ])
})

test('libras y arrobas sin unidad: una va en gramos, la otra queda cruda para quien importe', () => {
  const [ex] = parseRoutineDraft('Deadlift 3x5 225 lb')?.days[0].exercises ?? []
  expect(ex.weightG).toBe(102_058)
  expect(ex.weight).toBeNull()

  const [bare] = parseRoutineDraft('Curl 3x12 @20')?.days[0].exercises ?? []
  expect(bare.weightG).toBeNull()
  expect(bare.weight).toBe(20)
})

test('sin encabezado hay un día igual, sin nombre: se lo pone quien importa', () => {
  expect(shape('Press militar 4 series de 8 a 12')).toEqual([
    { name: '', weekIndex: null, exercises: [['Press militar', 4, 8, 12, null]] },
  ])
})

test('las semanas salen de sus encabezados y numeran los días', () => {
  const draft = parseRoutineDraft(`
    Semana 1
    # Torso
    Bench press 3x8
    Semana 2
    # Pierna
    Squat 3x8
  `)
  expect(draft?.weeks).toBe(2)
  expect(draft?.days.map((d) => [d.name, d.weekIndex])).toEqual([
    ['Torso', 0],
    ['Pierna', 1],
  ])
})

test('CSV: encabezado con reps, o con reps_min y reps_max, y el peso con su unidad', () => {
  expect(
    shape(`day,exercise,sets,reps,weight,unit
Push,Bench press,3,8-12,60,kg
Push,Dips,3,10,,
Pull,"Row, barbell",4,8,135,lb`),
  ).toEqual([
    {
      name: 'Push',
      weekIndex: null,
      exercises: [
        ['Bench press', 3, 8, 12, 60_000],
        ['Dips', 3, 10, 10, null],
      ],
    },
    { name: 'Pull', weekIndex: null, exercises: [['Row, barbell', 4, 8, 8, 61_235]] },
  ])

  expect(
    shape(`week,day,exercise,sets,reps_min,reps_max
1,A,Squat,5,5,5
2,A,Squat,3,3,3`),
  ).toEqual([
    { name: 'A', weekIndex: 0, exercises: [['Squat', 5, 5, 5, null]] },
    { name: 'A', weekIndex: 1, exercises: [['Squat', 3, 3, 3, null]] },
  ])
})

test('CSV sin unidad: el número queda crudo para que lo resuelva la unidad de ajustes', () => {
  const draft = parseRoutineDraft(`day,exercise,sets,reps,weight
A,Squat,3,5,100`)
  expect(draft?.days[0].exercises[0]).toMatchObject({ weight: 100, weightG: null })
})

test('el JSON que exporta la app vuelve entero, con seedId y semanas', () => {
  const draft = parseRoutineDraft(
    JSON.stringify({
      format: 'gym-tracker-routine',
      version: 1,
      name: 'Fuerza',
      weeks: 2,
      days: [
        {
          name: 'A',
          weekIndex: 0,
          isDeload: false,
          exercises: [
            {
              seedId: 'bench_press',
              nameEs: 'Press banca',
              nameEn: 'Bench press',
              restSec: 180,
              supersetGroup: null,
              sets: [
                { kind: 'normal', repsMin: 5, repsMax: 5, targetRpe: 8 },
                { kind: 'normal', repsMin: 5, repsMax: 5, targetRpe: 8 },
              ],
            },
          ],
        },
        { name: 'B', weekIndex: 1, isDeload: true, exercises: [] },
      ],
    }),
  )

  expect(draft?.name).toBe('Fuerza')
  expect(draft?.weeks).toBe(2)
  expect(draft?.days.map((d) => [d.name, d.weekIndex, d.isDeload])).toEqual([
    ['A', 0, false],
    ['B', 1, true],
  ])
  expect(draft?.days[0].exercises[0]).toEqual({
    name: 'Press banca',
    repsMax: 5,
    repsMin: 5,
    restSec: 180,
    seedId: 'bench_press',
    setRows: [
      { kind: 'normal', repsMax: 5, repsMin: 5, targetRpe: 8 },
      { kind: 'normal', repsMax: 5, repsMin: 5, targetRpe: 8 },
    ],
    sets: 2,
    supersetGroup: null,
    weightG: null,
  })
})

test('el JSON con series distintas entre sí: el rango del preview sale de la primera de trabajo', () => {
  const draft = parseRoutineDraft(
    JSON.stringify({
      format: 'gym-tracker-routine',
      version: 1,
      name: 'Bloque',
      weeks: null,
      days: [
        {
          name: 'A',
          weekIndex: null,
          isDeload: true,
          exercises: [
            {
              seedId: null,
              nameEs: 'Press banca',
              nameEn: 'Bench press',
              restSec: 120,
              supersetGroup: 1,
              sets: [
                { kind: 'warmup', repsMin: 10, repsMax: 10, targetRpe: null },
                { kind: 'normal', repsMin: 8, repsMax: 12, targetRpe: 8 },
                { kind: 'inventado', repsMin: 8, repsMax: 12, targetRpe: null },
              ],
            },
          ],
        },
      ],
    }),
  )

  const ex = draft?.days[0].exercises[0]
  expect(draft?.days[0].isDeload).toBe(true)
  expect(ex?.supersetGroup).toBe(1)
  expect([ex?.repsMin, ex?.repsMax]).toEqual([8, 12])
  // El `kind` que no existe entra como serie normal, no llega inventado a la base.
  expect(ex?.setRows?.map((s) => s.kind)).toEqual(['warmup', 'normal', 'normal'])
})

test('lo que no se entiende devuelve null, y no un borrador vacío', () => {
  expect(parseRoutineDraft('')).toBeNull()
  expect(parseRoutineDraft('   \n  \n ')).toBeNull()
  expect(parseRoutineDraft('hola qué tal, esto no es una rutina')).toBeNull()
  expect(parseRoutineDraft('Push:\nPull:\nLegs:')).toBeNull()
  // JSON válido pero de otra cosa, y JSON roto.
  expect(parseRoutineDraft('{"format":"otra-app","days":[]}')).toBeNull()
  expect(parseRoutineDraft('{"format":"gym-tracker-routine",')).toBeNull()
  expect(parseRoutineDraft('{"format":"gym-tracker-routine","days":[]}')).toBeNull()
  // CSV con encabezado pero sin la columna de series.
  expect(parseRoutineDraft('day,exercise\nPush,Bench press')).toBeNull()
  // Un año no es una cantidad de series.
  expect(parseRoutineDraft('Rutina 2024 x 5')).toBeNull()
})
