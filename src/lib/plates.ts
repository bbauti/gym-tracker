/** A standard olympic bar. Bars per gym come in Phase 7 (J02). */
export const DEFAULT_BAR_G = 20_000

/** ponytail: fixed plate table. The per-gym one (`gym.plates_g`) is Phase 7 (J02). */
export const DEFAULT_PLATES_G = [25_000, 20_000, 15_000, 10_000, 5_000, 2_500, 1_250, 500]

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** Positive plates only, heaviest first: a zero or negative plate is an infinite loop. */
function usable(platesG: number[]): number[] {
  return platesG.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => b - a)
}

/**
 * Which per-side sums are reachable, on the grid of the plates' greatest common divisor.
 *
 * Plain greedy is what a plate calculator usually does, and with the default table it is wrong:
 * 1.5 kg a side is 3 × 0.5, but greedy takes the 1.25 and stalls with 0.25 left over. This is the
 * unbounded-coin DP instead — a few hundred cells for any bar a human loads.
 *
 * `from[i]` = the plate used to reach `i`, or -1 when `i` is not reachable at all.
 */
function reachable(cells: number, plates: number[], step: number): Int32Array {
  const from = new Int32Array(cells + 1).fill(-1)
  from[0] = 0
  for (let i = 1; i <= cells; i++) {
    for (const p of plates) {
      const k = p / step
      if (k <= i && from[i - k] >= 0) {
        from[i] = p
        break
      }
    }
  }
  return from
}

function decompose(index: number, from: Int32Array, step: number): number[] {
  const perSide: number[] = []
  let i = index
  while (i > 0) {
    const plate = from[i]
    perSide.push(plate)
    i -= plate / step
  }
  return perSide.sort((a, b) => b - a)
}

// ponytail: exact only while the grid stays small (a 2-tonne bar at 250 g resolution). Past that it
// falls back to greedy, which nobody loading 2 tonnes will notice.
const MAX_CELLS = 8_192

function greedy(needG: number, plates: number[]): number[] {
  const perSide: number[] = []
  let left = needG
  for (const p of plates) {
    while (p <= left) {
      perSide.push(p)
      left -= p
    }
  }
  return perSide
}

/**
 * The heaviest loading that does not go over `targetG`, per side, heaviest plate first.
 * `null` when the target is under the bar — there is nothing to load.
 */
export function platesFor(
  targetG: number,
  barG: number,
  platesG: number[],
): { perSide: number[]; achievedG: number } | null {
  if (targetG < barG) return null
  const plates = usable(platesG)
  const need = (targetG - barG) / 2
  if (plates.length === 0 || need <= 0) return { perSide: [], achievedG: barG }

  const step = plates.reduce(gcd)
  const cells = Math.floor(need / step)
  if (cells > MAX_CELLS) {
    const perSide = greedy(need, plates)
    return { perSide, achievedG: barG + 2 * perSide.reduce((a, b) => a + b, 0) }
  }

  const from = reachable(cells, plates, step)
  let i = cells
  while (from[i] < 0) i--
  const perSide = decompose(i, from, step)
  return { perSide, achievedG: barG + 2 * i * step }
}

/**
 * The loadable weight closest to `targetG` — above or below. Ties go to the lighter one.
 * Under the bar there is only the bar.
 */
export function nearestLoadable(targetG: number, barG: number, platesG: number[]): number {
  const plates = usable(platesG)
  const need = (targetG - barG) / 2
  if (plates.length === 0 || need <= 0) return barG

  const step = plates.reduce(gcd)
  const cells = Math.ceil(need / step) + Math.ceil(plates[0] / step)
  if (cells > MAX_CELLS) {
    const below = greedy(need, plates).reduce((a, b) => a + b, 0)
    const above = below + plates[plates.length - 1]
    return need - below <= above - need ? barG + 2 * below : barG + 2 * above
  }

  const from = reachable(cells, plates, step)
  let best = 0
  let bestDistance = need
  for (let i = 1; i <= cells; i++) {
    if (from[i] < 0) continue
    const d = Math.abs(i * step - need)
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return barG + 2 * best * step
}
