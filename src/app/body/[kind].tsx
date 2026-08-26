import { Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Keyboard, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import Animated from 'react-native-reanimated'
import {
  addMetric,
  type BodyKind,
  type BodyMetricRow,
  deleteMetric,
  history,
  restoreMetric,
  series,
} from '@/db/queries/body'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import { haptic } from '@/ui/haptics'
import MetricChart, { formatMetric, metricUnit, parseMetric, toDisplay } from '@/ui/MetricChart'
import { RowLayout, useEnterFade } from '@/ui/motion'
import SwipeRow from '@/ui/SwipeRow'
import Text from '@/ui/Text'
import { toast } from '@/ui/Toast'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

/** La ventana del gráfico (I02). La lista de abajo no la usa: lo viejo se tiene que poder borrar. */
const DAYS = 90
const ENTRIES = 100

const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[6] },
  form: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  input: {
    flex: 1,
    minHeight: MIN_TARGET,
    borderRadius: radius.md,
    backgroundColor: colors.fill,
    paddingHorizontal: spacing[3],
    fontSize: 17,
    lineHeight: 22,
    color: colors.label,
    fontVariant: ['tabular-nums'],
  },
  list: { gap: spacing[2] },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[2],
  },
  value: { flex: 1 },
})

/** I02/I03. Una medida: su curva, el alta de hoy y todo lo anotado. */
export default function BodyMetricScreen() {
  const { kind } = useLocalSearchParams<{ kind: BodyKind }>()
  const name = t(`body.kinds.${kind}`)
  const unit = useQuery(() => getSettings().unit, ['settings'])
  const data = useQuery(
    () => ({ chart: series(kind, DAYS), entries: history(kind, ENTRIES) }),
    ['body_metric'],
    [kind],
  )
  const [text, setText] = useState('')
  // Solo la medida recién agregada (o la que vuelve con Deshacer) entra con fade.
  const fadeIn = useEnterFade(data.entries.map((r) => r.id))

  const parsed = parseMetric(kind, text, unit)
  const valid = parsed !== null && parsed > 0

  function save() {
    if (!valid) return
    addMetric(kind, parsed)
    setText('')
    // El toast vive abajo de todo: con el teclado abierto quedaría tapado, y la medida recién
    // guardada está justo debajo del formulario.
    Keyboard.dismiss()
    toast.show({ text: t('body.added') })
  }

  // Sin diálogo (§7.5): se borra y queda el toast de deshacer. El háptico va antes del write.
  function remove(row: BodyMetricRow) {
    haptic('delete')
    const deleted = deleteMetric(row.id)
    toast.show({
      actionLabel: t('common.undo'),
      onAction: () => {
        haptic('undo')
        restoreMetric(deleted)
      },
      text: t('body.deleted'),
    })
  }

  const points = data.chart.map((r) => ({
    date: r.measuredAt,
    value: toDisplay(kind, r.value, unit),
  }))

  /** El gráfico es un solo elemento accesible: acá va lo que dibuja, en palabras. */
  function chartLabel(rows: BodyMetricRow[]): string {
    const last = rows[rows.length - 1]
    const diff = last.value - rows[0].value
    return t('body.chartA11y', {
      delta: `${diff < 0 ? '−' : '+'}${formatMetric(kind, Math.abs(diff), unit)}`,
      last: formatMetric(kind, last.value, unit),
      n: rows.length,
      name,
    })
  }

  return (
    <KeyboardAvoidingView automaticOffset behavior="padding" style={styles.screen}>
      <Stack.Screen options={{ title: name }} />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        // "Añadir" es la única forma de guardar (el decimal-pad no tiene tecla de retorno): sin
        // esto el primer toque con el teclado abierto se lo come la ScrollView para cerrarlo.
        keyboardShouldPersistTaps="handled"
      >
        {points.length >= 2 ? (
          <Card>
            <MetricChart
              data={points}
              label={chartLabel(data.chart)}
              unit={metricUnit(kind, unit)}
            />
          </Card>
        ) : null}

        <Card>
          <View style={styles.form}>
            <TextInput
              accessibilityLabel={`${name}, ${metricUnit(kind, unit)}`}
              inputMode="decimal"
              keyboardType="decimal-pad"
              maxFontSizeMultiplier={1.6}
              onChangeText={setText}
              placeholder={metricUnit(kind, unit)}
              placeholderTextColor={colors.tertiaryLabel}
              returnKeyType="done"
              style={styles.input}
              value={text}
            />
            <Button disabled={!valid} onPress={save} title={t('body.add')} />
          </View>
        </Card>

        {data.entries.length === 0 ? (
          <Text color="secondary">{t('body.empty')}</Text>
        ) : (
          <Card style={styles.list}>
            {data.entries.map((row) => (
              // El hueco que deja una medida borrada lo cierra RowLayout.
              <Animated.View entering={fadeIn(row.id)} key={row.id} layout={RowLayout}>
                <SwipeRow onDelete={() => remove(row)}>
                  <View
                    accessible
                    accessibilityLabel={`${formatMetric(kind, row.value, unit)}, ${dayFormat.format(new Date(row.measuredAt))}`}
                    style={styles.entry}
                  >
                    <Text style={styles.value} tabular>
                      {formatMetric(kind, row.value, unit)}
                    </Text>
                    <Text color="secondary" role="footnote">
                      {dayFormat.format(new Date(row.measuredAt))}
                    </Text>
                  </View>
                </SwipeRow>
              </Animated.View>
            ))}
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
