import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t } from '@/i18n'
import EmptyState from '@/ui/EmptyState'
import { colors } from '@/ui/tokens'

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.background } })

export default function HistoryScreen() {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <EmptyState
        description={t('history.empty.description')}
        md="history"
        sf="clock.arrow.circlepath"
        title={t('history.empty.title')}
      />
    </View>
  )
}
