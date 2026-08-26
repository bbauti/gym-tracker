import { router } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { createSession, getActiveSessionId, getSessionTree } from '@/db/queries/session'
import { useQuery } from '@/db/useQuery'
import { t } from '@/i18n'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import EmptyState from '@/ui/EmptyState'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, spacing } from '@/ui/tokens'

const SESSION_TABLES = ['session']

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  // La tab no tiene header propio: la fila del engranaje hace de barra y come el inset de arriba.
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing[2] },
  gear: {
    alignItems: 'center',
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    width: MIN_TARGET,
  },
  body: { flex: 1, justifyContent: 'center', padding: spacing[4] },
  card: { gap: spacing[1] },
  footer: { padding: spacing[4] },
})

// ponytail: mismo helper que settings.tsx, copiado (cinco líneas y una key compartida).
// Techo: si aparece un tercer caller hay que mudarlo a lib/. Nunca dice "hace 3 días".
function relativeTime(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000))
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.minutesAgo', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('time.hoursAgo', { n: hours })
  return t('time.daysAgo', { n: Math.round(hours / 24) })
}

function activeSession() {
  const id = getActiveSessionId()
  return id === null ? null : (getSessionTree(id)?.session ?? null)
}

export default function TrainScreen() {
  const insets = useSafeAreaInsets()
  const current = useQuery(activeSession, SESSION_TABLES)

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PressableScale
          accessibilityLabel={t('settings.title')}
          onPress={() => router.push('/settings')}
          style={styles.gear}
        >
          <SymbolView
            fallback={<Text role="title">⚙</Text>}
            name={{ ios: 'gearshape' as SFSymbol, android: 'settings' as AndroidSymbol }}
            size={24}
            tintColor={colors.label}
          />
        </PressableScale>
      </View>

      {current ? (
        <View style={styles.body}>
          <PressableScale
            accessibilityLabel={`${t('session.continue')}, ${current.name ?? t('session.untitled')}`}
            onPress={() => router.push({ params: { id: current.id }, pathname: '/session/[id]' })}
            scale={0.98}
          >
            <Card style={styles.card}>
              <Text role="headline">{current.name ?? t('session.untitled')}</Text>
              <Text color="secondary" role="footnote">
                {t('session.activeSince', { when: relativeTime(current.startedAt) })}
              </Text>
              <Text color="tint" role="callout">
                {t('session.continue')}
              </Text>
            </Card>
          </PressableScale>
        </View>
      ) : (
        <>
          <EmptyState
            description={t('train.empty.description')}
            md="fitness_center"
            sf="figure.strengthtraining.traditional"
            title={t('train.empty.title')}
          />
          <View style={styles.footer}>
            <Button
              onPress={() => {
                const id = createSession()
                router.push({ params: { id }, pathname: '/session/[id]' })
              }}
              title={t('session.start')}
            />
          </View>
        </>
      )}
    </View>
  )
}
