import { SET_KINDS, type SetKind } from '@/db/schema'
import { unitToG } from './units'

/**
 * D08. Pegar una rutina de donde sea y que salga algo importable: el JSON que exporta la app, un CSV
 * de planilla, o el texto suelto de un cuaderno ("Press banca 3x8-12 @60kg").
 *
 * Devuelve un borrador, nunca escribe: quien importa (`db/queries/routines.ts`) es el único que
 * toca las tablas de rutina (§2.2). `null` = no se entendió nada, y la pantalla lo dice.
 */

/** Una serie tal cual estaba: solo el JSON de la app sabe tanto. */
export type DraftSet = {
  kind: SetKind
  repsMin: number | null
  repsMax: number | null
  targetRpe: number | null
}

export type DraftExercise = {
  name: string
  /** Solo lo trae el JSON de la app: el import lo prefiere a buscar por nombre. */
  seedId?: string | null
  sets: number
  repsMin: number | null
  repsMax: number | null
  /** Ya en gramos, cuando el texto dijo kg o lb. */
  weightG: number | null
  /** El número pelado cuando no dijo unidad: lo resuelve quien importa, con la de ajustes. */
  weight?: number | null
  restSec?: number | null
  supersetGroup?: number | null
  /** Las series de verdad, cuando las hay: `sets` es solo cuántas son. */
  setRows?: DraftSet[]
}

export type DraftDay = {
  /** Vacío = venía sin encabezado; quien importa le pone "Día n". */
  name: string
  weekIndex: number | null
  isDeload?: boolean
  exercises: DraftExercise[]
}

export type RoutineDraft = {
  name: string | null
  /** `null` = una sola semana, igual que `routine.weeks`. */
  weeks: number | null
  days: DraftDay[]
}

/** Lo que escribe `exportRoutine`. Se compara a mano: la entrada es texto de afuera, no un tipo. */
const FORMAT = 'gym-tracker-routine'

/** Series y repeticiones: `3x8-12`, `3 x 10`, `5×5`, `4 sets 12 reps`, `4 series de 8 a 12`. */
const SETS_REPS =
  /(\d+)\s*(?:[x×*]|\bsets?\b|\bseries?\b)\s*(?:of\s+|de\s+)?(\d+)(?:(?:\s*[-–—]\s*|\s+a\s+)(\d+))?/i
/** El peso va al final de la línea: `@60kg`, `100 kg`, `135 lb`. */
const WEIGHT_UNIT = /(?:@\s*)?(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|lbs?)\s*$/i
/** Sin unidad solo con arroba: un número suelto al final es demasiado ambiguo. */
const WEIGHT_BARE = /@\s*(\d+(?:[.,]\d+)?)\s*$/
const WEEK_HEADER = /^#{0,3}\s*(?:week|semana)\s*#?\s*(\d+)\s*:?\s*$/i
/** Viñetas y numeraciones de lista, que no son parte del nombre del ejercicio. */
const BULLET = /^\s*(?:[-*•·]|\d+[.)])\s+/
/** Lo que queda colgando entre el nombre y las series: `Row — 4 sets`. */
const TRAILING = /[\s,;:–—-]+$/

const num = (text: string) => Number(text.replace(',', '.'))

function toInt(text: string | undefined): number | null {
  if (!text) return null
  const value = Number.parseInt(text, 10)
  return Number.isFinite(value) ? value : null
}

/** `8-12`, `8 a 12` o `10` a secas. */
function repRange(text: string | undefined): { min: number; max: number } | null {
  if (!text) return null
  const m = /^(\d+)(?:(?:\s*[-–—]\s*|\s+a\s+)(\d+))?/.exec(text.trim())
  if (!m) return null
  const min = Number(m[1])
  return { max: m[2] ? Number(m[2]) : min, min }
}

/** Un ejercicio de verdad tiene entre 1 y 20 series: más es un año o un peso mal leído. */
function plausible(sets: number, reps: number): boolean {
  return sets >= 1 && sets <= 20 && reps >= 1 && reps <= 500
}

function exerciseLine(line: string): DraftExercise | null {
  let rest = line.replace(BULLET, '').trim()
  if (!rest) return null

  let weightG: number | null = null
  let weight: number | null = null
  const withUnit = WEIGHT_UNIT.exec(rest)
  const bare = withUnit ? null : WEIGHT_BARE.exec(rest)
  if (withUnit) {
    weightG = unitToG(num(withUnit[1]), /^lb/i.test(withUnit[2]) ? 'lb' : 'kg')
    rest = rest.slice(0, withUnit.index).trim()
  } else if (bare) {
    weight = num(bare[1])
    rest = rest.slice(0, bare.index).trim()
  }

  const m = SETS_REPS.exec(rest)
  if (!m) return null
  const name = rest.slice(0, m.index).replace(TRAILING, '').trim()
  const sets = Number(m[1])
  const repsMin = Number(m[2])
  if (!name || !plausible(sets, repsMin)) return null

  return { name, repsMax: m[3] ? Number(m[3]) : repsMin, repsMin, sets, weight, weightG }
}

/** `# Push`, `Day 1`, `Día 2`, `Piernas:` — todo lo que abre un día. */
function dayHeader(line: string): string | null {
  const hash = /^#{1,3}\s*(.+)$/.exec(line)
  if (hash) return hash[1].replace(/:$/, '').trim() || null
  if (/^(?:day|d[ií]a)\b/i.test(line)) return line.replace(/:$/, '').trim()
  return line.endsWith(':') ? line.slice(0, -1).trim() || null : null
}

/** Sin semanas, todos los días quedan en `null` (= una sola semana, como en el schema). */
function finish(
  draft: RoutineDraft,
  maxWeek: number,
  declared: number | null = null,
): RoutineDraft | null {
  if (draft.days.every((d) => d.exercises.length === 0)) return null
  const weeks = Math.max(declared ?? 0, maxWeek + 1)
  if (weeks > 1) {
    draft.weeks = weeks
    for (const day of draft.days) day.weekIndex ??= 0
  } else {
    draft.weeks = null
    for (const day of draft.days) day.weekIndex = null
  }
  return draft
}

function parseText(text: string): RoutineDraft | null {
  const draft: RoutineDraft = { days: [], name: null, weeks: null }
  let weekIndex: number | null = null
  let maxWeek = -1
  let day: DraftDay | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    const week = WEEK_HEADER.exec(line)
    if (week) {
      weekIndex = Math.max(0, Number(week[1]) - 1)
      maxWeek = Math.max(maxWeek, weekIndex)
      day = null
      continue
    }

    // Antes que el encabezado: un ejercicio puede terminar en ':' y no por eso abre un día.
    const exercise = exerciseLine(line)
    if (exercise) {
      if (!day) {
        day = { exercises: [], name: '', weekIndex }
        draft.days.push(day)
      }
      day.exercises.push(exercise)
      continue
    }

    const header = dayHeader(line)
    if (header) {
      day = { exercises: [], name: header, weekIndex }
      draft.days.push(day)
      continue
    }

    // Una línea suelta antes de todo es el nombre de la rutina.
    if (draft.name === null && draft.days.length === 0) draft.name = line
  }

  return finish(draft, maxWeek)
}

/** RFC 4180 mínimo: comillas dobles para escapar comas y comillas. */
function splitCsv(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c !== '"') cell += c
      else if (line[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') {
      cells.push(cell)
      cell = ''
    } else cell += c
  }
  cells.push(cell)
  return cells
}

function csvHeader(line: string): string[] | null {
  const cells = splitCsv(line).map((c) => c.trim().toLowerCase().replace(/\s+/g, '_'))
  return cells.includes('day') && cells.includes('exercise') ? cells : null
}

function parseCsv(lines: string[]): RoutineDraft | null {
  const head = csvHeader(lines[0])
  if (!head) return null
  const at = (name: string) => head.indexOf(name)
  const [iWeek, iDay, iEx, iSets] = [at('week'), at('day'), at('exercise'), at('sets')]
  const [iReps, iMin, iMax] = [at('reps'), at('reps_min'), at('reps_max')]
  const [iWeight, iUnit] = [at('weight'), at('unit')]
  if (iSets < 0 || (iReps < 0 && iMin < 0)) return null

  const draft: RoutineDraft = { days: [], name: null, weeks: null }
  const byKey = new Map<string, DraftDay>()
  let maxWeek = -1

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cells = splitCsv(line).map((c) => c.trim())
    const name = cells[iEx] ?? ''
    const sets = toInt(cells[iSets])
    const reps = iReps >= 0 ? repRange(cells[iReps]) : null
    const min = reps ? reps.min : toInt(cells[iMin])
    const max = reps ? reps.max : (toInt(cells[iMax]) ?? min)
    if (!name || sets === null || min === null || !plausible(sets, min)) continue

    const week = iWeek >= 0 ? toInt(cells[iWeek]) : null
    const weekIndex = week === null ? null : Math.max(0, week - 1)
    if (weekIndex !== null) maxWeek = Math.max(maxWeek, weekIndex)

    const dayName = cells[iDay] ?? ''
    const key = `${weekIndex ?? ''}|${dayName}`
    let day = byKey.get(key)
    if (!day) {
      day = { exercises: [], name: dayName, weekIndex }
      byKey.set(key, day)
      draft.days.push(day)
    }

    const raw = iWeight >= 0 ? cells[iWeight] : ''
    const value = raw ? num(raw) : Number.NaN
    const unit = iUnit >= 0 ? (cells[iUnit] ?? '').toLowerCase() : ''
    day.exercises.push({
      name,
      repsMax: max,
      repsMin: min,
      sets,
      weight: Number.isFinite(value) && !unit ? value : null,
      weightG:
        Number.isFinite(value) && unit ? unitToG(value, unit.startsWith('lb') ? 'lb' : 'kg') : null,
    })
  }

  return finish(draft, maxWeek)
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const KINDS: readonly string[] = SET_KINDS

/** El `kind` viene de afuera: cualquier cosa que no esté en el enum entra como serie normal. */
function setRow(raw: Record<string, unknown>): DraftSet {
  const repsMin = int(raw.repsMin)
  return {
    kind: KINDS.includes(str(raw.kind)) ? (raw.kind as SetKind) : 'normal',
    repsMax: int(raw.repsMax) ?? repsMin,
    repsMin,
    targetRpe: int(raw.targetRpe),
  }
}

/**
 * El JSON que exporta la app: las series vuelven una por una en `setRows`, así que exportar e
 * importar no pierde el tipo, el RPE ni el rango propio de cada una. `repsMin`/`repsMax` del
 * borrador son solo para el preview de la pantalla, que muestra un rango por ejercicio.
 */
function parseJson(text: string): RoutineDraft | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(data) || data.format !== FORMAT) return null

  const draft: RoutineDraft = { days: [], name: str(data.name) || null, weeks: null }
  let maxWeek = -1

  for (const rawDay of array(data.days)) {
    if (!isRecord(rawDay)) continue
    const weekIndex = int(rawDay.weekIndex)
    if (weekIndex !== null) maxWeek = Math.max(maxWeek, weekIndex)
    const day: DraftDay = {
      exercises: [],
      isDeload: rawDay.isDeload === true,
      name: str(rawDay.name),
      weekIndex,
    }
    draft.days.push(day)

    for (const rawEx of array(rawDay.exercises)) {
      if (!isRecord(rawEx)) continue
      const name = str(rawEx.nameEs) || str(rawEx.nameEn)
      const rows = array(rawEx.sets).filter(isRecord).map(setRow)
      if (!name || rows.length === 0) continue
      // El rango del preview sale de la primera serie de trabajo: si la primera es de calentamiento,
      // sus repeticiones no son las del ejercicio.
      const work = rows.find((s) => s.kind !== 'warmup') ?? rows[0]
      day.exercises.push({
        name,
        repsMax: work.repsMax,
        repsMin: work.repsMin,
        restSec: int(rawEx.restSec),
        seedId: typeof rawEx.seedId === 'string' ? rawEx.seedId : null,
        setRows: rows,
        sets: rows.length,
        supersetGroup: int(rawEx.supersetGroup),
        weightG: null,
      })
    }
  }

  return finish(draft, maxWeek, int(data.weeks))
}

export function parseRoutineDraft(text: string): RoutineDraft | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) return parseJson(trimmed)
  const lines = trimmed.split(/\r?\n/)
  return csvHeader(lines[0]) ? parseCsv(lines) : parseText(trimmed)
}
