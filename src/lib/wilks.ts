/**
 * J09. Puntaje de powerlifting: cuánto vale un total según el peso corporal.
 *
 * Las dos fórmulas son un polinomio del peso corporal en kg, con coeficientes publicados distintos
 * por sexo. Se copian tal cual: tocar un decimal cambia el puntaje de todo el historial.
 */

export type Sex = 'm' | 'f'

/** Coeficientes de menor a mayor grado, y el rango de peso corporal donde la fórmula está definida. */
type Table = { minKg: number; maxKg: number; coefficients: readonly number[] }

/** Wilks 2020 (el "nuevo Wilks"), numerador 600. */
const WILKS_2020: Record<Sex, Table> = {
  m: {
    minKg: 40,
    maxKg: 200,
    coefficients: [
      47.4617885411949, 8.47206137941125, 0.073694103462609, -1.39583381094385e-3,
      7.07665973070743e-6, -1.20804336482315e-8,
    ],
  },
  f: {
    minKg: 40,
    maxKg: 150,
    coefficients: [
      -125.425539779509, 13.7121941940668, -0.0330725063103405, -1.0504000506583e-3,
      9.38773881462799e-6, -2.3334613884954e-8,
    ],
  },
}

/** DOTS, numerador 500. Un grado menos que Wilks. */
const DOTS: Record<Sex, Table> = {
  m: {
    minKg: 40,
    maxKg: 210,
    coefficients: [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093],
  },
  f: {
    minKg: 40,
    maxKg: 150,
    coefficients: [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706],
  },
}

function score(totalG: number, bodyweightG: number, table: Table, numerator: number): number {
  if (!(totalG > 0) || !(bodyweightG > 0)) return 0
  // Fuera del rango el polinomio se da vuelta (se hace negativo): se evalúa en el borde.
  const kg = Math.min(Math.max(bodyweightG / 1000, table.minKg), table.maxKg)
  const denominator = table.coefficients.reduce((sum, c, i) => sum + c * kg ** i, 0)
  return ((totalG / 1000) * numerator) / denominator
}

export function wilks2020(totalG: number, bodyweightG: number, sex: Sex): number {
  return score(totalG, bodyweightG, WILKS_2020[sex], 600)
}

export function dots(totalG: number, bodyweightG: number, sex: Sex): number {
  return score(totalG, bodyweightG, DOTS[sex], 500)
}
