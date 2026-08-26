import { DarkTheme, DefaultTheme, type ErrorBoundaryProps, Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { Suspense, use, useEffect } from 'react'
import { StyleSheet, useColorScheme, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ready } from '@/db/client'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { t } from '@/i18n'
import Button from '@/ui/Button'
import { setHapticsEnabled } from '@/ui/haptics'
import Text from '@/ui/Text'
import { colors, spacing } from '@/ui/tokens'

SplashScreen.preventAutoHideAsync().catch(() => {})

const styles = StyleSheet.create({
  root: { flex: 1 },
  crash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[5],
    backgroundColor: colors.background,
  },
  centered: { textAlign: 'center' },
})

/** Todo lo de abajo asume migraciones + seed aplicados; el splash cubre la espera. */
function Gate() {
  use(ready)
  const haptics = useQuery(() => getSettings().haptics, ['settings'])

  useEffect(() => {
    setHapticsEnabled(haptics)
  }, [haptics])

  useEffect(() => {
    SplashScreen.hideAsync()
  }, [])

  // Los formSheet (pick-exercise, plates, session-edit) se registran acá en la Fase 2.
  return <Stack screenOptions={{ headerShown: false }} />
}

/** expo-router envuelve hasta el layout raíz en <Try catch={ErrorBoundary}>: sin esto, un `ready`
 *  rechazado (migración rota, db corrupta) deja el splash puesto para siempre y sin mensaje. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    SplashScreen.hideAsync()
  }, [])
  return (
    <View style={styles.crash}>
      <Text role="headline" style={styles.centered}>
        {t('error.title')}
      </Text>
      <Text color="secondary" style={styles.centered}>
        {error.message}
      </Text>
      <Button onPress={retry} title={t('error.retry')} variant="tinted" />
    </View>
  )
}

export default function RootLayout() {
  const scheme = useColorScheme()
  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Suspense fallback={null}>
          <Gate />
        </Suspense>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
