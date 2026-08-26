import { useQuickActionRouting } from 'expo-quick-actions/router'
import {
  DarkTheme,
  DefaultTheme,
  type ErrorBoundaryProps,
  router,
  Stack,
  ThemeProvider,
} from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { Suspense, use, useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet, useColorScheme, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { startAutoBackup } from '@/db/backup'
import { ready } from '@/db/client'
import { backfillPrs } from '@/db/queries/prs'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { t } from '@/i18n'
import { available, unlock } from '@/lock'
import { configureNotifications } from '@/notifications'
import { setup as setupQuickActions } from '@/quickActions'
import Button from '@/ui/Button'
import { haptic, setHapticsEnabled } from '@/ui/haptics'
import LockScreen from '@/ui/LockScreen'
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

/** Mirar una notificación o la cámara entre series no puede costar una huella cada vez. */
const LOCK_GRACE_MS = 30_000

/**
 * Bloqueo de la app (L10). Bloquea en el arranque en frío y al volver después de un rato largo
 * afuera. `busy` es a la vez "hay un diálogo del sistema abierto" y el disparador: el efecto es el
 * único que llama a `unlock()` (el botón solo lo vuelve a poner en true), así que nunca hay dos.
 */
function useAppLock(appLock: boolean) {
  // El valor del primer render decide el arranque en frío; encenderlo en Ajustes no bloquea al toque.
  const [locked, setLocked] = useState(appLock)
  const [busy, setBusy] = useState(appLock)
  const [failed, setFailed] = useState(false)
  const lockedRef = useRef(locked)
  const leftAt = useRef<number | null>(null)

  useEffect(() => {
    lockedRef.current = locked
  }, [locked])

  useEffect(() => {
    if (!busy) return
    // El overlay es un hermano del Stack: en iOS un `modal`/`formSheet` se presenta arriba de la
    // vista raíz de RN y quedaría visible (y usable) por encima del bloqueo. Cerrar lo presentado es
    // parte de bloquear; cuesta el borrador de una hoja abierta, que es el precio correcto acá.
    if (router.canDismiss()) router.dismissAll()
    let done = false
    void (async () => {
      // Sin nada enrolado `unlock()` no puede dar true nunca: sin este atajo, borrar la huella con
      // el bloqueo puesto deja la app encerrada y sin manera de llegar a Ajustes para apagarlo.
      const ok = (await available()) ? await unlock() : true
      if (done) return
      setBusy(false)
      if (!ok) {
        setFailed(true)
        return
      }
      haptic('success')
      setFailed(false)
      setLocked(false)
    })()
    return () => {
      done = true
    }
  }, [busy])

  // Con el overlay puesto no se anota la salida: en Android el diálogo del sistema manda la app a
  // background, y esa ausencia es del propio desbloqueo — contarla lo volvería a bloquear al volver.
  useEffect(() => {
    if (!appLock) return
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        if (!lockedRef.current) leftAt.current ??= Date.now()
        return
      }
      const at = leftAt.current
      leftAt.current = null
      if (at !== null && Date.now() - at > LOCK_GRACE_MS) {
        setLocked(true)
        setBusy(true)
      }
    })
    return () => sub.remove()
  }, [appLock])

  return { locked, busy, failed, retry: () => setBusy(true) }
}

/** Todo lo de abajo asume migraciones + seed aplicados; el splash cubre la espera. */
function Gate() {
  use(ready)
  const haptics = useQuery(() => getSettings().haptics, ['settings'])
  // Query aparte y no `getSettings()` entero: así el layout raíz no re-renderiza con cada ajuste.
  const appLock = useQuery(() => getSettings().appLock, ['settings'])
  const lock = useAppLock(appLock)

  useEffect(() => {
    setHapticsEnabled(haptics)
  }, [haptics])

  useEffect(() => {
    SplashScreen.hideAsync()
  }, [])

  // El historial de antes de la Fase 5 no tiene récords: se reconstruyen una vez (`personal_record`
  // es cache, no dato). Acá y no en `client.ts` porque `queries/prs` importa el cliente (ciclo).
  useEffect(() => backfillPrs(), [])

  // Backup rotativo al mandar la app a background (devuelve la baja de la suscripción).
  useEffect(() => startAutoBackup(), [])

  // Handler de foreground + canal de Android. Acá y no en el import: el permiso se pide recién
  // cuando arranca el primer descanso (§ Fase 3), esto solo configura cómo se muestran.
  useEffect(() => configureNotifications(), [])

  // Los atajos del ícono (L09): se declaran una vez y el sistema se los queda hasta la próxima.
  useEffect(() => setupQuickActions(), [])

  // Calienta el cache de `lock.available()`: la fila de Ajustes lo lee sincrónico y así no arranca
  // deshabilitada la primera vez que se abre el modal.
  useEffect(() => {
    void available()
  }, [])

  // Resuelve el `href` del atajo, tanto el que abrió la app en frío como el de un toque con la app
  // viva. Acá y no en RootLayout: navega, así que el Stack de abajo ya tiene que estar montado.
  useQuickActionRouting()

  // Un solo Stack raíz: los formSheet son rutas, nunca un <Modal> de RN (§7.5). El título de la
  // sesión lo pone la pantalla con su propio <Stack.Screen>, porque depende de la fila.
  // El ToastHost va después del Stack (se dibuja encima) y una sola vez en toda la app: es una vista
  // absoluta con pointerEvents="box-none", así que no le roba taps a nada. Los dos van adentro de la
  // misma View para poder esconderlos juntos de los lectores de pantalla cuando el bloqueo está.
  return (
    <>
      {/* Todo lo que el bloqueo tapa sale del árbol de accesibilidad mientras está puesto:
          `accessibilityElementsHidden` es iOS y `importantForAccessibility` Android, hacen falta las
          dos. Sin esto, TalkBack sigue leyendo (y activando) la sesión y las tabs de abajo. */}
      <View
        accessibilityElementsHidden={lock.locked}
        importantForAccessibility={lock.locked ? 'no-hide-descendants' : 'auto'}
        style={styles.root}
      >
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
          <Stack.Screen
            name="routine/[id]"
            options={{ headerShown: true, headerBackTitle: t('common.back'), title: '' }}
          />
          <Stack.Screen
            name="routine/new"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
            }}
          />
          {/* La misma hoja renombra la rutina (`id`) o el día (`dayId`, con el toggle de deload). */}
          <Stack.Screen
            name="routine-edit"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
            }}
          />
          <Stack.Screen
            name="routine-day/[id]"
            options={{ headerShown: true, headerBackTitle: t('common.back'), title: '' }}
          />
          <Stack.Screen
            name="routine-set"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
            }}
          />
          <Stack.Screen
            name="routine-move"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
            }}
          />
          <Stack.Screen
            name="feedback"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
            }}
          />
          <Stack.Screen
            name="landmarks"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
            }}
          />
          <Stack.Screen
            name="routine-import"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.75, 1],
              sheetGrabberVisible: true,
            }}
          />
          {/* Herramientas (fase 7a y 7b): cada una pone su propio título con su <Stack.Screen>. */}
          <Stack.Screen name="calculators" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="gyms" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="gym/[id]" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="body" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="body/[kind]" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="folders" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="intervals" options={{ headerShown: true, title: '' }} />
          {/* Desvío del quick action (L09): se reemplaza sola, así que animarla sería un slide de más
            antes del de la sesión. El header ya viene oculto de `screenOptions`. */}
          <Stack.Screen name="start" options={{ animation: 'none' }} />
        </Stack>
        <ToastHost />
      </View>
      {/* Último: tapa todo, tabs y toasts incluidos. Con el bloqueo apagado no se monta nunca. */}
      {lock.locked ? (
        <LockScreen busy={lock.busy} failed={lock.failed} onUnlock={lock.retry} />
      ) : null}
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
