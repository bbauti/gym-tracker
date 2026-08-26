import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { t } from '@/i18n'

export default function TabsLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('tabs.train')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="fitness_center" sf="dumbbell" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>{t('tabs.history')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="history" sf="clock.arrow.circlepath" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="progress">
        <NativeTabs.Trigger.Label>{t('tabs.progress')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="trending_up" sf="chart.line.uptrend.xyaxis" />
      </NativeTabs.Trigger>
      {/* role="search" → systemItem 'search': en iOS 26 es un item destacado que no muestra ningún
          título (ni el del sistema ni el propio), de ahí el accessibilityLabel. El Label manda en Android. */}
      <NativeTabs.Trigger accessibilityLabel={t('tabs.exercises')} name="exercises" role="search">
        <NativeTabs.Trigger.Label>{t('tabs.exercises')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="search" sf="magnifyingglass" />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
