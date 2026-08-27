import type { Unit } from './units'

/**
 * Lee el CSV de historial: el mismo que escribe `exportCsv` (round-trip) y también uno hecho a mano.
 * Puro a propósito — cero imports de react-native o de la base, para poder testearlo con bun.
 *
 * Lo único obligatorio es la cabecera con `date` y el nombre del ejercicio; el orden de las columnas
 * es libre, las que no conoce las ignora, y una fila que no se entiende se cuenta en `skipped` en vez
 * de tirar el archivo entero.
 */

export type ParsedSet = {
  /** El `set_index` del archivo (1-based), o la posición dentro del ejercicio si la columna falta. */
  index: number
  /** Sin validar: el catálogo de tipos vive en el schema, y este módulo no lo importa. */
  kind: string
  /** El número tal cual de la columna de peso. La unidad la decide quien importa (ver `unit`). */
  weight: number | null
  /** Solo si el archivo trae columna `unit`: el export de la app escribe kg siempre. */
  unit: Unit | null
  reps: number | null
  durationS: number | null
  distanceM: number | null
  rpe: number | null
  rir: number | null
  completedAt: number | null
  note: string | null
}

export type ParsedExercise = { nameEs: string; nameEn: string | null; sets: ParsedSet[] }

export type ParsedSession = {
  /** Día local + nombre de sesión: dos filas con el mismo par son el mismo entrenamiento. */
  key: string
  name: string | null
  startedAt: number
  endedAt: number
  exercises: ParsedExercise[]
}

export type ParsedHistory = { sessions: ParsedSession[]; skipped: number }

/** Nombres aceptados por columna; el primero de cada lista es el que escribe `exportCsv`. */
const COLUMNS = {
  completed: ['completed'],
  date: ['date'],
  distanceKm: ['distance_km'],
  distanceM: ['distance_m'],
  durationS: ['duration_s'],
  index: ['set_index'],
  kind: ['kind'],
  nameEn: ['exercise_en'],
  nameEs: ['exercise_es', 'exercise'],
  note: ['note'],
  reps: ['reps'],
  rir: ['rir'],
  rpe: ['rpe'],
  sessionName: ['session_name'],
  unit: ['unit'],
  weight: ['weight_kg', 'weight'],
}

type Field = keyof typeof COLUMNS

/** Hora de una fila sin hora, y cuánto se separan entre sí las series de ese día. */
const DEFAULT_HOUR = 18
const STEP_MS = 90_000
/** El minuto de aire antes de la primera serie y después de la última: la sesión las contiene. */
const PAD_MS = 60_000

/** RFC 4180 a mano: comillas dobles adentro de comillas, CRLF o LF, y la última fila sin salto. */
function splitCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

/** `at: null` = el archivo dio solo el día, y la hora la pone el segundo paso. */
function parseDate(text: string): { day: string; at: number | null } | null {
  const m = DATE.exec(text.trim())
  if (!m) return null
  const [, y, mo, d, hh, mi, ss] = m
  const date = new Date(+y, +mo - 1, +d, +(hh ?? 0), +(mi ?? 0), +(ss ?? 0))
  // Un 31 de febrero rueda a marzo en vez de fallar: eso no es una fila válida.
  if (date.getMonth() !== +mo - 1 || date.getDate() !== +d) return null
  return { at: hh === undefined ? null : date.getTime(), day: `${+y}-${+mo}-${+d}` }
}

function dayBase(day: string): number {
  const [y, mo, d] = day.split('-').map(Number)
  return new Date(y, mo - 1, d, DEFAULT_HOUR).getTime()
}

/**
 * Una planilla en español escribe "12,5" y una en inglés "1,234.5": el último separador es el
 * decimal y los de antes son de miles, así que un peso con miles no se pierde como NaN.
 */
function num(text: string): number | null {
  if (!text) return null
  const raw = text.replace(/\s/g, '')
  const dec = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'))
  const clean = dec < 0 ? raw : `${raw.slice(0, dec).replace(/[.,]/g, '')}.${raw.slice(dec + 1)}`
  const value = Number(clean)
  return Number.isFinite(value) ? value : null
}

/** Un peso o unas reps negativas son un error de tipeo: sin valor antes que en los récords. */
function pos(value: number | null): number | null {
  return value === null || value < 0 ? null : value
}

/** RPE y RIR son escalas de 0 a 10; un 99 se comería el gráfico de esfuerzo. */
function scale(value: number | null): number | null {
  return value === null || value < 0 || value > 10 ? null : value
}

function int(text: string): number | null {
  const value = num(text)
  return value === null ? null : Math.round(value)
}

type Row = {
  day: string
  at: number | null
  sessionName: string | null
  nameEs: string
  nameEn: string | null
  exKey: string
  completed: boolean
  /** La serie ya armada; `completedAt` se llena recién cuando se conoce la hora de la fila. */
  set: ParsedSet
}

export function parseHistoryCsv(text: string): ParsedHistory | null {
  // El BOM que dejan Excel y Numbers vuelve inservible el nombre de la primera columna.
  const rows = splitCsv(text.replace(/^\uFEFF/, ''))
  const header = rows.shift()
  if (!header) return null

  const at: Partial<Record<Field, number>> = {}
  header.forEach((name, i) => {
    const key = name.trim().toLowerCase()
    for (const [field, names] of Object.entries(COLUMNS) as [Field, string[]][]) {
      if (at[field] === undefined && names.includes(key)) at[field] = i
    }
  })
  if (at.date === undefined || (at.nameEs === undefined && at.nameEn === undefined)) return null

  const cell = (row: string[], field: Field): string => {
    const i = at[field]
    return i === undefined ? '' : (row[i] ?? '').trim()
  }

  let skipped = 0
  const grouped = new Map<string, Row[]>()
  /** Cuántas series lleva ya ese ejercicio en esa sesión: el `set_index` cuando la columna falta. */
  const seq = new Map<string, number>()

  for (const row of rows) {
    if (row.every((c) => c.trim() === '')) continue
    const when = parseDate(cell(row, 'date'))
    const nameEs = cell(row, 'nameEs') || cell(row, 'nameEn')
    if (!when || !nameEs) {
      skipped++
      continue
    }

    const sessionName = cell(row, 'sessionName') || null
    // \u0000 y no un espacio: "A B" + "c" y "A" + "B c" tienen que dar claves distintas.
    const key = `${when.day}\u0000${sessionName ?? ''}`
    const exKey = nameEs.toLowerCase()
    const n = (seq.get(`${key}\u0000${exKey}`) ?? 0) + 1
    seq.set(`${key}\u0000${exKey}`, n)

    const unit = cell(row, 'unit').toLowerCase()
    const km = num(cell(row, 'distanceKm'))
    const completed = cell(row, 'completed').toLowerCase()

    const parsed: Row = {
      at: when.at,
      // Vacío = completada: un archivo a mano rara vez trae la columna, y todo lo que anotó ya pasó.
      completed: completed !== '0' && completed !== 'false' && completed !== 'no',
      day: when.day,
      exKey,
      nameEn: cell(row, 'nameEn') || null,
      nameEs,
      sessionName,
      set: {
        completedAt: null,
        distanceM: pos(num(cell(row, 'distanceM')) ?? (km === null ? null : km * 1000)),
        durationS: pos(num(cell(row, 'durationS'))),
        index: int(cell(row, 'index')) ?? n,
        kind: cell(row, 'kind') || 'normal',
        note: cell(row, 'note') || null,
        reps: pos(int(cell(row, 'reps'))),
        rir: scale(int(cell(row, 'rir'))),
        rpe: scale(num(cell(row, 'rpe'))),
        unit: unit === 'kg' || unit === 'lb' ? unit : null,
        weight: pos(num(cell(row, 'weight'))),
      },
    }
    const list = grouped.get(key)
    if (list) list.push(parsed)
    else grouped.set(key, [parsed])
  }

  return { sessions: [...grouped.values()].map(session), skipped }
}

function session(list: Row[]): ParsedSession {
  // Los ejercicios quedan en el orden en el que aparecieron; las series, por `set_index`. `sort` es
  // estable, así que dos filas con el mismo índice conservan el orden del archivo.
  const order = new Map<string, number>()
  for (const row of list) if (!order.has(row.exKey)) order.set(row.exKey, order.size)
  list.sort(
    (a, b) => (order.get(a.exKey) ?? 0) - (order.get(b.exKey) ?? 0) || a.set.index - b.set.index,
  )

  let step = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const row of list) {
    // Fila con fecha sola: 18:00 y 90 s por serie, para que `completed_at` crezca dentro del día
    // (los récords se reproducen en ese orden).
    const when = row.at ?? dayBase(row.day) + step++ * STEP_MS
    row.at = when
    row.set.completedAt = row.completed ? when : null
    if (when < min) min = when
    if (when > max) max = when
  }

  const exercises: ParsedExercise[] = []
  const byKey = new Map<string, ParsedExercise>()
  for (const row of list) {
    let ex = byKey.get(row.exKey)
    if (!ex) {
      ex = { nameEn: row.nameEn, nameEs: row.nameEs, sets: [] }
      byKey.set(row.exKey, ex)
      exercises.push(ex)
    }
    // La traducción puede venir en cualquier fila del ejercicio, no solo en la primera.
    if (ex.nameEn === null) ex.nameEn = row.nameEn
    ex.sets.push(row.set)
  }

  return {
    endedAt: max + PAD_MS,
    exercises,
    key: `${list[0].day}\u0000${list[0].sessionName ?? ''}`,
    name: list[0].sessionName,
    startedAt: min - PAD_MS,
  }
}
