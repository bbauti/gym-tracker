import { useSegments } from 'expo-router'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { useEffect, useRef } from 'react'
import { t } from '@/i18n'
import { haptic } from '@/ui/haptics'

/**
 * El háptico de cambiar de pestaña (§12.3) sale de la ruta y no de `tabPress`: volver a tocar la
 * pestaña activa hace scroll-to-top, que no es un cambio y no se vibra.
 *
 * Fuera del grupo (un push a /settings) no hay pestaña: se ignora en vez de guardarse, si no volver
 * del push sonaría como cambio. Por lo mismo la primera pestaña conocida solo se anota — en el
 * montaje no hubo cambio.
 */
function useTabChangeHaptic(): void {
  const segments: string[] = useSegments()
  // '' es la raíz del grupo (la pestaña de entrenar); null, que estamos fuera de las tabs.
  const tab = segments[0] === '(tabs)' ? (segments[1] ?? '') : null
  const prev = useRef<string | null>(null)
  useEffect(() => {
    if (tab === null) return
    const before = prev.current
    prev.current = tab
    if (before !== null && before !== tab) haptic('tabChange')
  }, [tab])
}

export default function TabsLayout() {
  useTabChangeHaptic()
  return (
    // `minimizeBehavior` es iOS 26+: la barra se encoge al bajar y vuelve al subir, que es lo que
    // deja respirar al contenido largo. En Android el prop ni se lee (NativeTabsView.android.js).
    <NativeTabs minimizeBehavior="onScrollDown">
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
