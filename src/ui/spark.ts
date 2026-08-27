// 'spark' y no 'sparkline': macOS resuelve rutas sin distinguir mayúsculas, así que un
// `sparkline.ts` al lado de `Sparkline.tsx` se pisan — bun prueba la extensión .tsx primero y el
// test terminaba importando el componente. Mismo motivo que `confetti.ts` junto a `Celebration.tsx`.

/** Un punto ya en coordenadas del canvas: `y` crece hacia abajo. */
export type SparkPoint = [x: number, y: number]

export type SparkPoints = {
  points: SparkPoint[]
  /** Extremos de la serie: el consumidor los usa para rotular, acá solo definen la escala. */
  min: number
  max: number
}

/**
 * Mapea una serie al rectángulo del canvas (§12.4). La escala vertical es siempre min→max de la
 * propia serie, no 0→max: una sparkline de 12 semanas de volumen dibuja la FORMA, y anclarla en
 * cero aplana justo la variación que se quiere ver.
 *
 * `pad` entra por los cuatro lados y no es decorativo: el trazo de 2 px va centrado en el path y el
 * punto final tiene radio propio, así que sin margen el pico más alto y el último punto se cortan
 * contra el borde del canvas.
 *
 * Los tres casos degenerados salen sin NaN a propósito — un NaN en el path hace que Skia no dibuje
 * NADA y el tile queda vacío sin explicar por qué: serie vacía → cero puntos; un solo valor → un
 * punto al medio (no hay paso horizontal que repartir); serie plana → línea al medio (`span` 0
 * dividiría por cero).
 */
export function sparklinePoints(
  values: number[],
  width: number,
  height: number,
  pad = 2,
): SparkPoints {
  const n = values.length
  if (n === 0) return { max: 0, min: 0, points: [] }

  let min = values[0]
  let max = values[0]
  for (let i = 1; i < n; i++) {
    if (values[i] < min) min = values[i]
    if (values[i] > max) max = values[i]
  }

  const innerWidth = Math.max(0, width - pad * 2)
  const innerHeight = Math.max(0, height - pad * 2)
  const span = max - min

  const points: SparkPoint[] = values.map((v, i) => [
    n === 1 ? width / 2 : pad + (i * innerWidth) / (n - 1),
    span === 0 ? pad + innerHeight / 2 : pad + (1 - (v - min) / span) * innerHeight,
  ])

  return { max, min, points }
}
