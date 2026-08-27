import { expect, test } from 'bun:test'
import { parseHistoryCsv } from './historyCsv'

/** Local, igual que el export: el CSV no lleva zona horaria. */
const at = (day: number, hour: number, min = 0, sec = 0) =>
  new Date(2026, 7, day, hour, min, sec).getTime()

/** La cabecera exacta que escribe `exportCsv`. */
const HEADER =
  'date,session_name,exercise_es,exercise_en,set_index,kind,weight_kg,reps,duration_s,distance_m,rpe,rir,completed,note'

const EXPORT = [
  HEADER,
  '2026-08-25T10:00:00,Torso,Press banca,Bench press,1,warmup,40,10,,,,,1,',
  '2026-08-25T10:03:00,Torso,Press banca,Bench press,2,normal,60,8,,,8,,1,',
  '2026-08-25T10:06:00,Torso,Dominadas,Pull-up,1,normal,,10,,,,,1,"al fallo, casi"',
  '2026-08-26T09:00:00,Pierna,Sentadilla,Squat,1,normal,100,5,,,,2,0,',
].join('\r\n')

test('lee el CSV que exporta la app y lo agrupa en sesiones', () => {
  const parsed = parseHistoryCsv(`${EXPORT}\r\n`)
  if (!parsed) throw new Error('no parseó')

  expect(parsed.skipped).toBe(0)
  expect(parsed.sessions.map((s) => s.name)).toEqual(['Torso', 'Pierna'])

  const [torso, pierna] = parsed.sessions
  // Un minuto de aire alrededor de la primera y la última serie.
  expect(torso.startedAt).toBe(at(25, 10, 0) - 60_000)
  expect(torso.endedAt).toBe(at(25, 10, 6) + 60_000)
  expect(torso.exercises.map((e) => [e.nameEs, e.nameEn])).toEqual([
    ['Press banca', 'Bench press'],
    ['Dominadas', 'Pull-up'],
  ])

  const bench = torso.exercises[0]
  expect(bench.sets.map((s) => [s.index, s.kind, s.weight, s.reps, s.rpe])).toEqual([
    [1, 'warmup', 40, 10, null],
    [2, 'normal', 60, 8, 8],
  ])
  expect(bench.sets.map((s) => s.completedAt)).toEqual([at(25, 10, 0), at(25, 10, 3)])

  const pullUp = torso.exercises[1].sets[0]
  expect(pullUp.weight).toBeNull()
  expect(pullUp.note).toBe('al fallo, casi')

  // `completed = 0`: la serie entra igual, pero sin fecha de completada.
  expect(pierna.exercises[0].sets[0].completedAt).toBeNull()
  expect(pierna.exercises[0].sets[0].rir).toBe(2)
})

test('las celdas entrecomilladas se abren enteras, con comas y comillas adentro', () => {
  const parsed = parseHistoryCsv(
    [
      'date,session_name,exercise_es,reps,note',
      '2026-08-25 10:00,"Torso, tirón",Remo,10,"dijo ""alto"", y salió"',
    ].join('\n'),
  )
  const session = parsed?.sessions[0]
  expect(session?.name).toBe('Torso, tirón')
  expect(session?.exercises[0].sets[0].note).toBe('dijo "alto", y salió')
})

test('LF y CRLF dan exactamente lo mismo', () => {
  expect(parseHistoryCsv(EXPORT.replace(/\r\n/g, '\n'))).toEqual(parseHistoryCsv(EXPORT))
})

test('una fila con la fecha sola cae a las 18:00 y suma 90 s por serie', () => {
  const parsed = parseHistoryCsv(
    [
      'date,exercise_es,set_index,weight_kg,reps',
      '2026-08-25,Press banca,1,60,8',
      '2026-08-25,Press banca,2,60,7',
      '2026-08-25,Remo,1,50,10',
    ].join('\n'),
  )
  const session = parsed?.sessions[0]
  const base = at(25, 18)
  expect(session?.exercises[0].sets.map((s) => s.completedAt)).toEqual([base, base + 90_000])
  // El reloj sigue corriendo entre ejercicios: `completed_at` crece a lo largo de la sesión.
  expect(session?.exercises[1].sets[0].completedAt).toBe(base + 180_000)
  expect(session?.startedAt).toBe(base - 60_000)
  expect(session?.endedAt).toBe(base + 180_000 + 60_000)
})

test('sin columnas opcionales: el índice lo pone el orden y todo lo demás queda vacío', () => {
  const parsed = parseHistoryCsv(
    ['date,exercise_es,reps', '2026-08-25,Press banca,8', '2026-08-25,Press banca,7'].join('\n'),
  )
  const sets = parsed?.sessions[0].exercises[0].sets
  expect(parsed?.sessions[0].name).toBeNull()
  expect(sets?.map((s) => [s.index, s.reps, s.kind])).toEqual([
    [1, 8, 'normal'],
    [2, 7, 'normal'],
  ])
  expect(sets?.[0]).toMatchObject({ distanceM: null, durationS: null, note: null, weight: null })
  // Sin columna `completed`, todo lo que está anotado ya pasó.
  expect(sets?.[0].completedAt).toBe(at(25, 18))
})

test('el tipo de serie y las columnas de tiempo/distancia viajan tal cual', () => {
  const parsed = parseHistoryCsv(
    [
      'date,exercise_es,kind,weight_kg,reps,duration_s,distance_m,unit',
      '2026-08-25 08:00,Press banca,drop,50,12,,,',
      '2026-08-25 08:10,Cinta,normal,,,1800,5000,',
      '2026-08-25 08:20,Press banca,inventado,100,3,,,lb',
    ].join('\n'),
  )
  const [press, cinta] = parsed?.sessions[0].exercises ?? []
  expect(press.sets.map((s) => s.kind)).toEqual(['drop', 'inventado'])
  expect(press.sets.map((s) => s.unit)).toEqual([null, 'lb'])
  expect(cinta.sets[0]).toMatchObject({ distanceM: 5000, durationS: 1800, reps: null })
})

test('los números fuera de rango no entran, y los miles no se pierden', () => {
  const parsed = parseHistoryCsv(
    [
      'date,exercise_es,weight_kg,reps,rpe,rir,duration_s',
      '2026-08-25,Press banca,-5,-3,99,-1,-10',
      // El separador de miles de una planilla en inglés y de una en español.
      '2026-08-25,Press banca,"1,234.5",3,,,',
      '2026-08-25,Press banca,"1.234,5",3,,,',
    ].join('\n'),
  )
  const sets = parsed?.sessions[0].exercises[0].sets
  expect(sets?.[0]).toMatchObject({
    durationS: null,
    reps: null,
    rir: null,
    rpe: null,
    weight: null,
  })
  expect(sets?.map((s) => s.weight)).toEqual([null, 1234.5, 1234.5])
})

test('las filas que no se entienden se cuentan, no rompen el archivo', () => {
  const parsed = parseHistoryCsv(
    [
      'date,exercise_es,reps',
      'hola que tal',
      '2026-13-45,Press banca,8',
      '2026-08-25,,8',
      '',
      '2026-08-25,Press banca,8',
    ].join('\n'),
  )
  expect(parsed?.skipped).toBe(3)
  expect(parsed?.sessions).toHaveLength(1)
  expect(parsed?.sessions[0].exercises[0].sets).toHaveLength(1)
})

test('sin las columnas mínimas no hay nada que importar', () => {
  expect(parseHistoryCsv('foo,bar\n1,2')).toBeNull()
  expect(parseHistoryCsv('')).toBeNull()
  // La fecha sola no alcanza: hace falta el ejercicio, en cualquiera de los dos idiomas.
  expect(parseHistoryCsv('date,reps\n2026-08-25,8')).toBeNull()
  expect(parseHistoryCsv('date,exercise_en,reps\n2026-08-25,Bench press,8')?.sessions).toHaveLength(
    1,
  )
})
