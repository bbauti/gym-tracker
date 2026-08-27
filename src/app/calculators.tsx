import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { latest } from '@/db/queries/body'
import { activeGym } from '@/db/queries/gyms'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import { DEFAULT_BAR_G, DEFAULT_PLATES_G, nearestLoadable } from '@/lib/plates'
import { e1rmG } from '@/lib/prs'
import { formatWeight, gToUnit, parseWeight, type Unit } from '@/lib/units'
import { warmupRamp } from '@/lib/warmup'
import { dots, wilks2020 } from '@/lib/wilks'
import Bento from '@/ui/Bento'
import Card from '@/ui/Card'
import Chip from '@/ui/Chip'
import Input from '@/ui/Input'
import { useAndroidKeyboardHeight } from '@/ui/keyboard'
import { useStagger } from '@/ui/motion'
import PressableScale from '@/ui/PressableScale'
import SectionHeader from '@/ui/SectionHeader'
import Text from '@/ui/Text'
import Tile from '@/ui/Tile'
import { colors, MIN_TARGET, spacing } from '@/ui/tokens'

const PERCENTS = Array.from({ length: 11 }, (_, i) => 50 + i * 5)
const EMPTY = '—'

const percentFormat = new Intl.NumberFormat(locale, { style: 'percent' })
const pointsFormat = new Intl.NumberFormat(locale, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const convertFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { padding: spacing[4], gap: spacing[5] },
  // Encabezado y card son una unidad; entre bloques manda el gap del contenido.
  block: { gap: spacing[2] },
  header: { paddingHorizontal: spacing[2] },
  card: { gap: spacing[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], minHeight: MIN_TARGET },
  compact: { minHeight: 32 },
  rowLabel: { flex: 1 },
  suffix: { minWidth: 22 },
  chips: { flexDirection: 'row', gap: spacing[2] },
  // Alto, fondo, radio y foco los pone `ui/Input`: acá solo el ancho y la alineación de la columna.
  input: { minWidth: 96, textAlign: 'right', fontVariant: ['tabular-nums'] },
  link: { justifyContent: 'center', minHeight: MIN_TARGET },
})

function Field({
  label,
  integer,
  onChangeText,
  suffix,
  value,
}: {
  label: string
  integer?: boolean
  onChangeText: (text: string) => void
  suffix?: string
  value: string
}) {
  return (
    <View style={styles.row}>
      {/* El campo ya se anuncia con esta etiqueta: dejarla visible al lector la lee dos veces. */}
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.rowLabel}
      >
        {label}
      </Text>
      <Input
        accessibilityLabel={label}
        keyboardType={integer ? 'number-pad' : 'decimal-pad'}
        onChangeText={onChangeText}
        placeholder="0"
        returnKeyType="done"
        style={styles.input}
        value={value}
      />
      {suffix ? (
        <Text
          accessibilityElementsHidden
          color="secondary"
          importantForAccessibility="no-hide-descendants"
          style={styles.suffix}
        >
          {suffix}
        </Text>
      ) : (
        <View style={styles.suffix} />
      )}
    </View>
  )
}

/** `spoken` es para cuando el valor tiene símbolos que el lector no dice (el × de la rampa). */
function OutRow({
  label,
  value,
  compact,
  spoken,
}: {
  label: string
  value: string
  compact?: boolean
  spoken?: string
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${spoken ?? value}`}
      style={[styles.row, compact && styles.compact]}
    >
      {/* En la tabla de porcentajes el label ES una columna de números: tabular y 13/600. */}
      <Text
        color="secondary"
        role={compact ? 'label' : 'body'}
        style={styles.rowLabel}
        tabular={compact}
      >
        {label}
      </Text>
      <Text role="headline" tabular>
        {value}
      </Text>
    </View>
  )
}

export default function CalculatorsScreen() {
  const settings = useQuery(() => getSettings(), ['settings'])
  const gym = useQuery(activeGym, ['settings', 'gym'])
  const bodyweightG = useQuery(() => latest('bodyweight')?.value ?? null, ['body_metric'])
  const keyboard = useAndroidKeyboardHeight()
  // Los resultados se montan con la pantalla y ya no vuelven a animar: tipear no dispara nada.
  const stagger = useStagger()

  // La primera barra del gimnasio activo es la que redondea todo; sin gimnasio, las tablas por
  // defecto. Un gimnasio sin barras cargadas también cae en la de 20 kg, y uno con todos los discos
  // apagados (`[]`, que no carga nada) en la tabla por defecto, igual que la hoja de discos.
  const load = {
    barG: gym?.barsG?.[0]?.g ?? DEFAULT_BAR_G,
    platesG: gym?.platesG?.length ? gym.platesG : DEFAULT_PLATES_G,
  }

  const unit = settings.unit
  const [rmWeight, setRmWeight] = useState('')
  const [rmReps, setRmReps] = useState('')
  const [workWeight, setWorkWeight] = useState('')
  const [convValue, setConvValue] = useState('')
  const [convFrom, setConvFrom] = useState<Unit>(unit)
  const [total, setTotal] = useState('')

  const weight = (g: number) => formatWeight(g, unit, locale)
  // En un tile la unidad va aparte del numeral: el número grande queda solo.
  const amount = (g: number) => formatWeight(g, unit, locale, { withUnit: false })
  const loadable = (g: number) => nearestLoadable(g, load.barG, load.platesG)

  const rmWeightG = parseWeight(rmWeight, unit)
  const reps = /^\d+$/.test(rmReps) ? Number(rmReps) : 0
  const oneRmG =
    rmWeightG !== null && rmWeightG > 0 && reps > 0
      ? e1rmG(rmWeightG, reps, settings.e1rmFormula)
      : null

  const workG = parseWeight(workWeight, unit)
  const ramp = workG !== null && workG > 0 ? warmupRamp(workG, load) : null

  const convG = parseWeight(convValue, convFrom)
  const convTo: Unit = convFrom === 'kg' ? 'lb' : 'kg'

  const totalG = parseWeight(total, unit)
  const sex = settings.sex
  const points =
    totalG !== null && totalG > 0 && bodyweightG !== null && sex !== null
      ? { wilks: wilks2020(totalG, bodyweightG, sex), dots: dots(totalG, bodyweightG, sex) }
      : null

  return (
    <>
      <Stack.Screen options={{ title: t('calc.title') }} />
      <ScrollView
        // En iOS el inset del teclado lo pone la ScrollView (y lleva el campo enfocado a la vista);
        // en Android no existe y el hueco lo pone el padding (ver `@/ui/keyboard`).
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.content, { paddingBottom: spacing[6] + keyboard }]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={styles.screen}
      >
        <View style={styles.block}>
          <SectionHeader style={styles.header} title={t('calc.oneRm')} />
          <Card style={styles.card}>
            <Field
              label={t('calc.weight')}
              onChangeText={setRmWeight}
              suffix={unit}
              value={rmWeight}
            />
            <Field integer label={t('calc.reps')} onChangeText={setRmReps} value={rmReps} />
          </Card>
          {/* Siempre montado, con guión mientras falte un dato: si apareciera al tipear, el tile
              entraría con animación en medio de una tecla (§7.5). */}
          <Bento.Row>
            <Tile
              entering={stagger(0)}
              title={t('calc.oneRm')}
              unit={oneRmG === null ? undefined : unit}
              value={oneRmG === null ? EMPTY : amount(oneRmG)}
            />
          </Bento.Row>
        </View>

        {/* Sin 1RM la tabla mostraría once veces la barra vacía: aparece cuando hay número. */}
        {oneRmG !== null ? (
          <View style={styles.block}>
            <SectionHeader style={styles.header} title={t('calc.percentages')} />
            <Card style={styles.card}>
              {PERCENTS.map((p) => (
                <OutRow
                  compact
                  key={p}
                  label={percentFormat.format(p / 100)}
                  value={weight(loadable((oneRmG * p) / 100))}
                />
              ))}
            </Card>
          </View>
        ) : null}

        <View style={styles.block}>
          <SectionHeader style={styles.header} title={t('calc.warmup')} />
          <Card style={styles.card}>
            <Field
              label={t('calc.workWeight')}
              onChangeText={setWorkWeight}
              suffix={unit}
              value={workWeight}
            />
            <Text color="secondary" role="footnote">
              {`${t('calc.bar')}: ${weight(load.barG)}`}
            </Text>
            {ramp?.length === 0 ? (
              <Text color="tertiary" role="footnote">
                {t('calc.rampEmpty')}
              </Text>
            ) : null}
            {ramp?.map((step, i) => (
              <OutRow
                key={step.weightG}
                label={t('calc.rampStep', { n: i + 1 })}
                spoken={`${weight(step.weightG)}, ${t('calc.rampReps', { n: step.reps })}`}
                value={`${weight(step.weightG)} × ${step.reps}`}
              />
            ))}
          </Card>
        </View>

        <View style={styles.block}>
          <SectionHeader style={styles.header} title={t('calc.converter')} />
          <Card style={styles.card}>
            <View style={styles.chips}>
              {(['kg', 'lb'] as const).map((u) => (
                <Chip
                  accessibilityLabel={`${t('calc.converter')}: ${u}`}
                  key={u}
                  label={u}
                  onPress={() => setConvFrom(u)}
                  selected={convFrom === u}
                />
              ))}
            </View>
            <Field
              label={t('calc.converter')}
              onChangeText={setConvValue}
              suffix={convFrom}
              value={convValue}
            />
            <OutRow
              label={t('calc.result')}
              value={
                convG === null ? EMPTY : `${convertFormat.format(gToUnit(convG, convTo))} ${convTo}`
              }
            />
          </Card>
        </View>

        <View style={styles.block}>
          <SectionHeader style={styles.header} title={`${t('calc.wilks')} / ${t('calc.dots')}`} />
          <Card style={styles.card}>
            <Field label={t('calc.total')} onChangeText={setTotal} suffix={unit} value={total} />
            {sex === null ? (
              <Text color="secondary" role="footnote">
                {t('calc.needsSex')}
              </Text>
            ) : null}
            {bodyweightG === null ? (
              // La otra falta se arregla en Ajustes, que es de donde se llega acá; esta no.
              <PressableScale
                accessibilityLabel={t('calc.needsBodyweight')}
                accessibilityRole="link"
                onPress={() => router.push('/body')}
                style={styles.link}
              >
                <Text color="tint" role="footnote">
                  {t('calc.needsBodyweight')}
                </Text>
              </PressableScale>
            ) : (
              <Text color="secondary" role="footnote">
                {`${t('body.kinds.bodyweight')}: ${weight(bodyweightG)}`}
              </Text>
            )}
          </Card>
          <Bento.Row>
            <Tile
              entering={stagger(1)}
              title={t('calc.wilks')}
              value={points === null ? EMPTY : pointsFormat.format(points.wilks)}
            />
            <Tile
              entering={stagger(2)}
              title={t('calc.dots')}
              value={points === null ? EMPTY : pointsFormat.format(points.dots)}
            />
          </Bento.Row>
        </View>
      </ScrollView>
    </>
  )
}
