import {
  DarkTheme,
  DefaultTheme,
  type ErrorBoundaryProps,
  router,
  Stack,
  ThemeProvider,
} from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { Suspense, use, useEffect } from 'react'
import { StyleSheet, useColorScheme, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { startAutoBackup } from '@/db/backup'
import { ready } from '@/db/client'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { t } from '@/i18n'
import Button from '@/ui/Button'
import { setHapticsEnabled } from '@/ui/haptics'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { ToastHost } from '@/ui/Toast'
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
  done: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
})

/** El modal no tiene botón atrás: sin esto solo se cierra arrastrando (y con VoiceOver, con nada). */
function DoneButton() {
  return (
    <PressableScale
      accessibilityLabel={t('settings.done')}
      onPress={() => router.back()}
      style={styles.done}
    >
      <Text color="tint" role="headline">
        {t('settings.done')}
      </Text>
    </PressableScale>
  )
}

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

  // Backup rotativo al mandar la app a background (devuelve la baja de la suscripción).
  useEffect(() => startAutoBackup(), [])

  // Un solo Stack raíz: los formSheet son rutas, nunca un <Modal> de RN (§7.5). El título de la
  // sesión lo pone la pantalla con su propio <Stack.Screen>, porque depende de la fila.
  // El ToastHost va después del Stack (se dibuja encima) y una sola vez en toda la app: es una vista
  // absoluta con pointerEvents="box-none", así que no le roba taps a nada.
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name="settings"
          options={{
            presentation: 'modal',
            headerShown: true,
            title: t('settings.title'),
            headerRight: () => <DoneButton />,
          }}
        />
        <Stack.Screen
          name="session/[id]"
          options={{ headerShown: true, headerBackTitle: t('common.back'), title: '' }}
        />
        <Stack.Screen
          name="session-edit"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="note"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="pick-exercise"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.5, 1],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="plates"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen name="exercise/[id]" options={{ headerShown: true, title: '' }} />
        <Stack.Screen
          name="exercise/new"
          options={{ presentation: 'formSheet', sheetAllowedDetents: [1] }}
        />
      </Stack>
      <ToastHost />
    </>
  )
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
      {/* Adentro del GestureHandlerRootView y arriba de todo: KeyboardProvider monta su vista nativa
          con flex: 1, así que en una hoja `fitToContents` mediría cero. Sin él, las
          KeyboardAvoidingView de las hojas (nota, editar sesión, elegir ejercicio) son un View. */}
      <KeyboardProvider>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Suspense fallback={null}>
            <Gate />
          </Suspense>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
