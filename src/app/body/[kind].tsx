import { Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native'
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
import BigNumber from '@/ui/BigNumber'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import { haptic } from '@/ui/haptics'
import Input from '@/ui/Input'
import ListRow from '@/ui/ListRow'
import MetricChart, { formatMetric, metricUnit, parseMetric, toDisplay } from '@/ui/MetricChart'
import { RowLayout, useEnterFade } from '@/ui/motion'
import SwipeRow from '@/ui/SwipeRow'
import Text from '@/ui/Text'
import { toast } from '@/ui/Toast'
import { colors, radius, spacing } from '@/ui/tokens'

/** La ventana del gráfico (I02). La lista de abajo no la usa: lo viejo se tiene que poder borrar. */
const DAYS = 90
const ENTRIES = 100

const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[6] },
  // El numeral y su curva son una sola cosa: el gap los junta sin línea de por medio.
  hero: { gap: spacing[3] },
  form: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  input: { flex: 1, fontVariant: ['tabular-nums'] },
  // Las filas se recortan solas (ui/SwipeRow): el grupo pone el fondo abajo para que las esquinas
  // de cada una no dejen ver el gris de la pantalla, y el mismo radio para que el corte coincida.
  group: {
    backgroundColor: colors.secondaryGroupedBackground,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  // El separador de la última fila cae fuera del recorte del grupo: ListRow lo dibuja siempre.
  lastRow: { marginBottom: -StyleSheet.hairlineWidth },
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

  // `history` viene de la más nueva a la más vieja: la primera es la que va arriba en grande.
  const latest = data.entries[0]

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
        {latest ? (
          <Card style={styles.hero} variant="raised">
            <BigNumber
              label={dayFormat.format(new Date(latest.measuredAt))}
              role="displaySmall"
              value={formatMetric(kind, latest.value, unit)}
            />
            {points.length >= 2 ? (
              <MetricChart
                data={points}
                label={chartLabel(data.chart)}
                unit={metricUnit(kind, unit)}
              />
            ) : null}
          </Card>
        ) : null}

        <Card>
          <View style={styles.form}>
            <Input
              accessibilityLabel={`${name}, ${metricUnit(kind, unit)}`}
              inputMode="decimal"
              keyboardType="decimal-pad"
              onChangeText={setText}
              placeholder={metricUnit(kind, unit)}
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
          <View style={styles.group}>
            {data.entries.map((row, i) => {
              const value = formatMetric(kind, row.value, unit)
              const day = dayFormat.format(new Date(row.measuredAt))
              return (
                // El hueco que deja una medida borrada lo cierra RowLayout.
                <Animated.View
                  entering={fadeIn(row.id)}
                  key={row.id}
                  layout={RowLayout}
                  style={i === data.entries.length - 1 ? styles.lastRow : null}
                >
                  <SwipeRow onDelete={() => remove(row)}>
                    {/* El valor manda y va a la derecha, tabular: la columna de números se lee de
                        arriba abajo sin que las comas bailen. */}
                    <ListRow
                      label={`${value}, ${day}`}
                      title={day}
                      trailing={
                        <Text role="headline" tabular>
                          {value}
                        </Text>
                      }
                    />
                  </SwipeRow>
                </Animated.View>
              )
            })}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
