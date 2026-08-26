import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t } from '@/i18n'
import Button from '@/ui/Button'
import EmptyState from '@/ui/EmptyState'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, spacing } from '@/ui/tokens'

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  // La tab no tiene header propio: la fila del engranaje hace de barra y come el inset de arriba.
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing[2] },
  gear: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { padding: spacing[4] },
})

export default function TrainScreen() {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <PressableScale
          accessibilityLabel={t('settings.title')}
          onPress={() => router.push('/settings')}
          style={styles.gear}
        >
          <SymbolView
            fallback={<Text role="title">⚙</Text>}
            name={{ ios: 'gearshape', android: 'settings' }}
            size={24}
            tintColor={colors.label}
          />
        </PressableScale>
      </View>
      <EmptyState
        description={t('train.empty.description')}
        md="fitness_center"
        sf="figure.strengthtraining.traditional"
        title={t('train.empty.title')}
      />
      {/* Ancla de la Fase 2: acá va createSession() + router.push('/session/[id]'). */}
      <View style={styles.footer}>
        <Button disabled onPress={() => {}} title={t('train.start')} />
      </View>
    </View>
  )
}
