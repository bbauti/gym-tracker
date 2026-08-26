import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t } from '@/i18n'
import EmptyState from '@/ui/EmptyState'
import { colors } from '@/ui/tokens'

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.background } })

export default function ProgressScreen() {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <EmptyState
        description={t('progress.empty.description')}
        md="trending_up"
        sf="chart.line.uptrend.xyaxis"
        title={t('progress.empty.title')}
      />
    </View>
  )
}
