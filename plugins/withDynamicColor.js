const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

// Material You (L06): `@color/tint` es un alias que Android resuelve por qualifier. En 12+ (`-v31`)
// apunta al accent del wallpaper; abajo, y en cualquier dispositivo sin dynamic color, cae al azul
// de la app. Un solo nombre para `PlatformColor('@color/tint')`, sin ramas en JS.
//
// `on_tint` (lo que va ENCIMA del tint) viaja en el mismo par y no puede ser blanco fijo: en la
// paleta de AOSP los números chicos son tonos CLAROS, así que el accent de dark (`_200`, el
// `colorPrimary` de M3 dark) es claro y su par es `_800`, no blanco. Con blanco, el tilde de la
// serie hecha quedaría en ~1.5:1.
//
// `surface_high`/`surface_low` son los contenedores tonales de M3 (v2, §12.3): "high" es el
// contenedor MÁS elevado, que en light es más OSCURO que la card y en dark más claro — la misma
// inversión que hace iOS entre `secondary`- y `tertiarySystemGroupedBackground`, que es a lo que
// mapean `colors.secondaryGroupedBackground` (low, la card) y `colors.tertiaryGroupedBackground`
// (high, el inset). Por eso `values` lleva el gris y `values-night` el tono claro, y no al revés.
const FALLBACK = '#0A84FF'
const WHITE = '#FFFFFF'
const variants = {
  values: [FALLBACK, WHITE, '#F2F2F7', '#FFFFFF'],
  'values-night': [FALLBACK, WHITE, '#2C2C2E', '#1C1C1E'],
  'values-v31': [
    '@android:color/system_accent1_600',
    '@android:color/system_accent1_0',
    '@android:color/system_neutral1_50',
    '@android:color/system_neutral1_10',
  ],
  'values-night-v31': [
    '@android:color/system_accent1_200',
    '@android:color/system_accent1_800',
    '@android:color/system_neutral1_800',
    '@android:color/system_neutral1_900',
  ],
}

const xml = ([tint, onTint, surfaceHigh, surfaceLow]) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="tint">${tint}</color>\n  <color name="on_tint">${onTint}</color>\n  <color name="surface_high">${surfaceHigh}</color>\n  <color name="surface_low">${surfaceLow}</color>\n</resources>\n`

// Archivo propio en vez de `withAndroidColors`: ese mod solo escribe `values/colors.xml` y acá hacen
// falta cuatro qualifiers distintos.
module.exports = (config) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const res = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res')
      for (const [dir, value] of Object.entries(variants)) {
        await fs.promises.mkdir(path.join(res, dir), { recursive: true })
        await fs.promises.writeFile(path.join(res, dir, 'colors_tint.xml'), xml(value))
      }
      return config
    },
  ])
