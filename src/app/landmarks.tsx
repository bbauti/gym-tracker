import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { landmarks, setLandmark } from '@/db/queries/progression'
import { MUSCLES, type Muscle } from '@/db/schema'
import { t } from '@/i18n'
import type { Landmark } from '@/lib/progression'
import { useSheetBottomInset } from '@/ui/keyboard'
import PressableScale from '@/ui/PressableScale'
import Stepper from '@/ui/Stepper'
import Text from '@/ui/Text'
import { colors, spacing } from '@/ui/tokens'

/** Nadie hace 40 series de un músculo en una semana; más arriba el ± deja de ser una herramienta. */
const MAX_SETS = 40

/** Las tres siglas, escritas una sola vez arriba: en la fila no entran sin recortarse. */
const LEGEND = [t('landmarks.mevLong'), t('landmarks.mavLong'), t('landmarks.mrvLong')].join(' · ')

// Sin flex: 1 — `fitToContents` mide el contenido y un hijo elástico mediría cero (hoja de 0 pt).
const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.background, gap: spacing[2], padding: spacing[4] },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing[2],
  },
  done: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
})

const isMuscle = (v: string | undefined): v is Muscle => MUSCLES.includes(v as Muscle)

/** E07: los MEV/MAV/MRV por músculo, editables sobre los valores por defecto. */
export default function LandmarksScreen() {
  const { muscle } = useLocalSearchParams<{ muscle: string }>()
  const bottom = useSheetBottomInset()
  // Lectura de arranque, no suscripción: la hoja es la única que escribe estos tres números
  // mientras está abierta, y refrescarla sola pisaría el valor que el dedo está subiendo.
  const [lm, setLm] = useState<Landmark | null>(() =>
    isMuscle(muscle) ? landmarks()[muscle] : null,
  )

  if (!isMuscle(muscle) || !lm) return null

  // Se escribe en cada cambio: la hoja se cierra arrastrándola y ahí no hay dónde poner un "guardar".
  const save = (next: Landmark) => {
    setLm(next)
    setLandmark(muscle, next)
  }

  // MEV <= MAV <= MRV no se puede dar vuelta desde la UI: mover uno empuja a los otros.
  const changeMev = (v: number) => {
    const mav = Math.max(v, lm.mav)
    save({ mav, mev: v, mrv: Math.max(mav, lm.mrv) })
  }
  const changeMav = (v: number) =>
    save({ mav: v, mev: Math.min(v, lm.mev), mrv: Math.max(v, lm.mrv) })
  const changeMrv = (v: number) => {
    const mav = Math.min(v, lm.mav)
    save({ mav, mev: Math.min(mav, lm.mev), mrv: v })
  }

  return (
    <View style={[styles.sheet, { paddingBottom: bottom + spacing[4] }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" role="headline">
          {t(`muscle.${muscle}`)}
        </Text>
        <PressableScale
          accessibilityLabel={t('common.done')}
          onPress={() => router.back()}
          style={styles.done}
        >
          <Text color="tint" role="headline">
            {t('common.done')}
          </Text>
        </PressableScale>
      </View>
      <Text color="secondary" role="footnote">
        {LEGEND}
      </Text>

      <Stepper
        accessibilityLabel={t('landmarks.mevLong')}
        label={t('landmarks.mev')}
        max={MAX_SETS}
        min={0}
        onChange={changeMev}
        value={lm.mev}
      />
      <Stepper
        accessibilityLabel={t('landmarks.mavLong')}
        label={t('landmarks.mav')}
        max={MAX_SETS}
        min={0}
        onChange={changeMav}
        value={lm.mav}
      />
      <Stepper
        accessibilityLabel={t('landmarks.mrvLong')}
        label={t('landmarks.mrv')}
        max={MAX_SETS}
        min={0}
        onChange={changeMrv}
        value={lm.mrv}
      />
    </View>
  )
}
