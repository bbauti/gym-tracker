import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t } from '@/i18n'
import Button from '@/ui/Button'
import EmptyState from '@/ui/EmptyState'
import { colors, spacing } from '@/ui/tokens'

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  footer: { padding: spacing[4] },
})

export default function TrainScreen() {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
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
