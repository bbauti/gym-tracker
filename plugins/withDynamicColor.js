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
const FALLBACK = '#0A84FF'
const WHITE = '#FFFFFF'
const variants = {
  values: [FALLBACK, WHITE],
  'values-night': [FALLBACK, WHITE],
  'values-v31': ['@android:color/system_accent1_600', '@android:color/system_accent1_0'],
  'values-night-v31': ['@android:color/system_accent1_200', '@android:color/system_accent1_800'],
}

const xml = ([tint, onTint]) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="tint">${tint}</color>\n  <color name="on_tint">${onTint}</color>\n</resources>\n`

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
