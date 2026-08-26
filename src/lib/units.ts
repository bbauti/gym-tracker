export type Unit = 'kg' | 'lb'

export const G_PER_LB = 453.59237
const G_PER_KG = 1000
const MM_PER_KM = 1_000_000
const MM_PER_MI = 1_609_344

const gPer = (unit: Unit) => (unit === 'kg' ? G_PER_KG : G_PER_LB)

const formatters = new Map<string, Intl.NumberFormat>()
function nf(locale: 'es' | 'en', maximumFractionDigits: number) {
  const key = `${locale}:${maximumFractionDigits}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-US', { maximumFractionDigits })
    formatters.set(key, f)
  }
  return f
}

export function gToUnit(g: number, unit: Unit): number {
  return g / gPer(unit)
}

export function unitToG(value: number, unit: Unit): number {
  return Math.round(value * gPer(unit))
}

export function formatWeight(
  g: number,
  unit: Unit,
  locale: 'es' | 'en',
  opts?: { withUnit?: boolean },
): string {
  const n = nf(locale, 2).format(gToUnit(g, unit))
  return opts?.withUnit === false ? n : `${n} ${unit}`
}

export function parseWeight(text: string, unit: Unit): number | null {
  const cleaned = text.trim().replace(',', '.')
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return unitToG(value, unit)
}

export function roundToIncrement(g: number, incG: number): number {
  if (!(incG > 0)) return Math.round(g)
  return Math.round(g / incG) * incG
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function formatDistance(mm: number, unit: 'km' | 'mi', locale: 'es' | 'en'): string {
  const value = mm / (unit === 'km' ? MM_PER_KM : MM_PER_MI)
  return `${nf(locale, 2).format(value)} ${unit}`
}
