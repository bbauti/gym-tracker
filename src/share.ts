import {
  ImageFormat,
  matchFont,
  PaintStyle,
  type SkCanvas,
  type SkFont,
  Skia,
  type SkPaint,
  StrokeCap,
  StrokeJoin,
} from '@shopify/react-native-skia'
import { File, Paths } from 'expo-file-system'
import { isAvailableAsync, shareAsync } from 'expo-sharing'
import { Platform } from 'react-native'

/**
 * N01/G19. La imagen que sale de la app tiene que verse igual en el teléfono de quien la comparte y
 * en el de quien la recibe: colores fijos claros, nunca los tokens del tema (una tarjeta en dark
 * llega negra a un chat en light y no se lee). Skia tampoco entiende `PlatformColor` (ver
 * ui/chartTheme.ts), así que estos hex son los únicos colores posibles acá.
 */
const PALETTE = {
  bg: '#FFFFFF',
  label: '#000000',
  secondary: '#6C6C70',
  tertiary: '#8E8E93',
  separator: '#D8D8DC',
  tint: '#007AFF',
}

/** La familia del sistema. Sin esto `matchFont` cae en la primera que encuentre el font manager. */
const FAMILY = Platform.select({ ios: 'Helvetica', default: 'sans-serif' })

const font = (size: number, weight: 'normal' | 'bold' = 'normal'): SkFont =>
  matchFont({ fontFamily: FAMILY, fontSize: size, fontWeight: weight })

function fill(color: string): SkPaint {
  const paint = Skia.Paint()
  paint.setAntiAlias(true)
  paint.setColor(Skia.Color(color))
  return paint
}

function stroke(color: string, width: number): SkPaint {
  const paint = fill(color)
  paint.setStyle(PaintStyle.Stroke)
  paint.setStrokeWidth(width)
  paint.setStrokeCap(StrokeCap.Round)
  paint.setStrokeJoin(StrokeJoin.Round)
  return paint
}

/** Un nombre de ejercicio largo no puede empujar al peso fuera de la tarjeta. */
function ellipsize(text: string, f: SkFont, max: number): string {
  if (f.measureText(text).width <= max) return text
  let cut = text
  while (cut.length > 1 && f.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1)
  return `${cut}…`
}

type WriteOptions = { font: SkFont; color: string; align?: 'left' | 'right'; max?: number }

/** `y` es la línea de base, como en Skia. Con `align: 'right'`, `x` es el borde derecho. */
function write(canvas: SkCanvas, text: string, x: number, y: number, o: WriteOptions): void {
  const value = o.max === undefined ? text : ellipsize(text, o.font, o.max)
  const left = o.align === 'right' ? x - o.font.measureText(value).width : x
  canvas.drawText(value, left, y, fill(o.color), o.font)
}

/** Los nombres de sesión viajan al nombre del archivo: una barra ahí es una carpeta que no existe. */
const slug = (name: string) =>
  name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 60) || 'gym-tracker'

/**
 * Dibuja `width`×`height` píxeles en una superficie fuera de pantalla, los guarda como PNG en cache
 * y abre la hoja de compartir. Tira si el dispositivo no puede compartir o si Skia no da superficie:
 * quien llama lo convierte en un toast (nunca bloquea la UI).
 */
export async function shareImage(
  name: string,
  width: number,
  height: number,
  draw: (canvas: SkCanvas, size: { width: number; height: number }) => void,
): Promise<void> {
  if (!(await isAvailableAsync())) throw new Error('sharing unavailable')
  const surface = Skia.Surface.MakeOffscreen(width, height)
  if (!surface) throw new Error('offscreen surface unavailable')
  // 1080×1350 RGBA son ~5,8 MB de buffer nativo: se sueltan a mano y no cuando pase el GC de JS,
  // porque compartir, cancelar y volver a compartir apila varios sobre una pantalla ya cargada.
  let bytes: Uint8Array
  try {
    draw(surface.getCanvas(), { height, width })
    surface.flush()
    const image = surface.makeImageSnapshot()
    try {
      bytes = image.encodeToBytes(ImageFormat.PNG)
    } finally {
      image.dispose()
    }
  } finally {
    surface.dispose()
  }
  const file = new File(Paths.cache, `${slug(name)}.png`)
  // `write` trunca: compartir dos veces el mismo entrenamiento pisa el archivo en vez de acumular.
  file.write(bytes)
  await shareAsync(file.uri, {
    UTI: 'public.png',
    dialogTitle: name,
    mimeType: 'image/png',
  })
}

/** Todo llega formateado: `share.ts` no sabe de unidades, de locale ni de la base. */
export type SessionCard = {
  title: string
  date: string
  /** Duración, volumen y récords: el valor ya escrito, con su etiqueta. */
  stats: Array<{ label: string; value: string }>
  /** Una línea por ejercicio, ya recortada a las que entran. */
  exercises: Array<{ name: string; detail: string }>
  /** Los ejercicios que no entraron, ya en palabras ('+3 ejercicios'), o `null`. */
  more: string | null
  footer: string
}

/** 2× sobre una tarjeta de 540×675: el PNG sale a 1080×1350, que es lo que pide una historia. */
const SCALE = 2
const CARD = { height: 675, width: 540 }
const PAD = 40
/** Diez ejercicios entran; el resto se resume en una línea. */
export const MAX_CARD_EXERCISES = 10
const EX_TOP = 306
const EX_STEP = 29

export function shareSession(card: SessionCard): Promise<void> {
  return shareImage(card.title, CARD.width * SCALE, CARD.height * SCALE, (canvas) => {
    canvas.scale(SCALE, SCALE)
    canvas.drawColor(Skia.Color(PALETTE.bg))

    const right = CARD.width - PAD
    const inner = right - PAD

    write(canvas, card.title, PAD, 100, {
      color: PALETTE.label,
      font: font(36, 'bold'),
      max: inner,
    })
    write(canvas, card.date, PAD, 132, { color: PALETTE.secondary, font: font(17), max: inner })

    // Tres columnas de ancho fijo: los valores arrancan alineados aunque uno sea "0:45" y otro
    // "12.480 kg". El separador de abajo cierra el bloque de cabecera.
    const column = inner / card.stats.length
    card.stats.forEach((stat, i) => {
      const x = PAD + column * i
      write(canvas, stat.value, x, 208, {
        color: PALETTE.label,
        font: font(30, 'bold'),
        max: column - 8,
      })
      write(canvas, stat.label, x, 236, {
        color: PALETTE.secondary,
        font: font(15),
        max: column - 8,
      })
    })
    canvas.drawLine(PAD, 266, right, 266, stroke(PALETTE.separator, 1))

    const nameFont = font(18)
    const detailFont = font(18, 'bold')
    card.exercises.forEach((exercise, i) => {
      const y = EX_TOP + EX_STEP * i
      const detail = exercise.detail
      const detailWidth = detailFont.measureText(detail).width
      write(canvas, exercise.name, PAD, y, {
        color: PALETTE.label,
        font: nameFont,
        max: inner - detailWidth - 16,
      })
      write(canvas, detail, right, y, {
        align: 'right',
        color: PALETTE.secondary,
        font: detailFont,
      })
    })
    if (card.more) {
      write(canvas, card.more, PAD, EX_TOP + EX_STEP * card.exercises.length, {
        color: PALETTE.tertiary,
        font: font(17),
        max: inner,
      })
    }

    write(canvas, card.footer, PAD, CARD.height - 40, {
      color: PALETTE.tint,
      font: font(17, 'bold'),
    })
  })
}

export type ChartCard = {
  title: string
  /**
   * Serie principal (tinte) y de contexto (gris), de la más vieja a la más nueva. Los valores van en
   * la escala que entienda `format` (gramos, hoy): el eje solo los compara entre sí.
   */
  main: { label: string; values: number[] }
  context: { label: string; values: number[] }
  /** La unidad, escrita una sola vez arriba de la columna de etiquetas (igual que en la app). */
  unit: string
  /** Fechas de los extremos del eje X, ya formateadas. */
  from: string
  to: string
  /** Las etiquetas del eje Y salen de acá: el formateo de números es del locale, no de este módulo. */
  format: (value: number) => string
  footer: string
}

const CHART = { height: 360, width: 540 }
/** Columna de las etiquetas del eje Y: entran cuatro dígitos. */
const GUTTER = 64
const PLOT_TOP = 116
const DOT = 9

export function shareChart(chart: ChartCard): Promise<void> {
  return shareImage(chart.title, CHART.width * SCALE, CHART.height * SCALE, (canvas) => {
    canvas.scale(SCALE, SCALE)
    canvas.drawColor(Skia.Color(PALETTE.bg))

    const right = CHART.width - PAD
    const left = PAD + GUTTER
    const bottom = CHART.height - 56

    write(canvas, chart.title, PAD, 56, {
      color: PALETTE.label,
      font: font(26, 'bold'),
      max: right - PAD,
    })

    // Leyenda: el punto lleva el color de la serie, el texto va siempre en gris (igual que en la app).
    const legendFont = font(14)
    let x = PAD
    for (const [color, label] of [
      [PALETTE.tint, chart.main.label],
      [PALETTE.tertiary, chart.context.label],
    ] as const) {
      canvas.drawCircle(x + DOT / 2, 82, DOT / 2, fill(color))
      write(canvas, label, x + DOT + 6, 87, { color: PALETTE.secondary, font: legendFont })
      x += DOT + 6 + legendFont.measureText(label).width + 20
    }

    const all = [...chart.main.values, ...chart.context.values]
    const max = Math.max(...all)
    const min = Math.min(...all)
    // Un rango de cero (dos sesiones con el mismo peso) dividiría por cero: la línea va al medio.
    const span = max - min || 1
    const y = (value: number) => bottom - ((value - min) / span) * (bottom - PLOT_TOP)

    write(canvas, chart.unit, left - 12, PLOT_TOP - 16, {
      align: 'right',
      color: PALETTE.tertiary,
      font: font(13),
    })
    for (const value of [max, min + span / 2, min]) {
      write(canvas, chart.format(value), left - 12, y(value) + 5, {
        align: 'right',
        color: PALETTE.tertiary,
        font: font(13),
        max: GUTTER - 12,
      })
    }

    const path = (values: number[]) => {
      const p = Skia.Path.Make()
      const step = values.length > 1 ? (right - left) / (values.length - 1) : 0
      values.forEach((value, i) => {
        const px = left + step * i
        if (i === 0) p.moveTo(px, y(value))
        else p.lineTo(px, y(value))
      })
      return p
    }
    // La de contexto primero: la que importa se dibuja encima.
    canvas.drawPath(path(chart.context.values), stroke(PALETTE.tertiary, 3))
    canvas.drawPath(path(chart.main.values), stroke(PALETTE.tint, 3))

    const dateFont = font(13)
    write(canvas, chart.from, left, bottom + 26, { color: PALETTE.tertiary, font: dateFont })
    write(canvas, chart.to, right, bottom + 26, {
      align: 'right',
      color: PALETTE.tertiary,
      font: dateFont,
    })
    write(canvas, chart.footer, PAD, CHART.height - 20, {
      color: PALETTE.tint,
      font: font(15, 'bold'),
    })
  })
}
