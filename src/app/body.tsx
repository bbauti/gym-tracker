import { router, Stack } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'
import { BODY_KINDS, latestAll } from '@/db/queries/body'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import ListRow from '@/ui/ListRow'
import { formatMetric } from '@/ui/MetricChart'
import Text from '@/ui/Text'
import { colors, outline, radius, shadow, spacing } from '@/ui/tokens'

const EMPTY = '—'
const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { padding: spacing[4] },
  // Levantado (§12.5): el fondo va acá para que la sombra tenga contra qué dibujarse, y el hairline
  // es lo que separa el grupo del fondo en dark, donde la sombra desaparece.
  group: {
    backgroundColor: colors.secondaryGroupedBackground,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  // El separador de la última fila cae fuera del recorte del grupo: ListRow lo dibuja siempre.
  lastRow: { marginBottom: -StyleSheet.hairlineWidth },
})

/** I01. Las doce medidas, con la última de cada una: la fila lleva al detalle, que es donde se cargan. */
export default function BodyScreen() {
  const unit = useQuery(() => getSettings().unit, ['settings'])
  const rows = useQuery(latestAll, ['body_metric'])

  return (
    <>
      <Stack.Screen options={{ title: t('body.title') }} />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        style={styles.screen}
      >
        <View style={[styles.group, shadow.card, outline]}>
          {BODY_KINDS.map((kind, i) => {
            const row = rows[kind]
            const name = t(`body.kinds.${kind}`)
            const value = row ? formatMetric(kind, row.value, unit) : EMPTY
            return (
              <View key={kind} style={i === BODY_KINDS.length - 1 ? styles.lastRow : null}>
                <ListRow
                  chevron
                  // Sin medidas la fila se anuncia con el nombre solo: "—" no se lee.
                  label={
                    row ? `${name}, ${value}, ${dayFormat.format(new Date(row.measuredAt))}` : name
                  }
                  onPress={() => router.push({ params: { kind }, pathname: '/body/[kind]' })}
                  subtitle={row ? dayFormat.format(new Date(row.measuredAt)) : undefined}
                  title={name}
                  trailing={
                    <Text color="secondary" tabular>
                      {value}
                    </Text>
                  }
                />
              </View>
            )
          })}
        </View>
      </ScrollView>
    </>
  )
}
