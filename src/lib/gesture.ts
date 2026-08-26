export function rubberband(overshoot: number, dimension: number, c = 0.55): number {
  'worklet'
  return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot))
}

export function project(velocityPxPerS: number, decelerationRate = 0.998): number {
  'worklet'
  return ((velocityPxPerS / 1000) * decelerationRate) / (1 - decelerationRate)
}

export function nearestSnap(value: number, points: readonly number[]): number {
  'worklet'
  let best = value
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i++) {
    const d = Math.abs(points[i] - value)
    if (d < bestDistance) {
      bestDistance = d
      best = points[i]
    }
  }
  return best
}
