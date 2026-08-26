import { router } from 'expo-router'
import { useLayoutEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { createSession, getActiveSessionId } from '@/db/queries/session'
import { ensureNotificationPermission } from '@/notifications'
import { colors } from '@/ui/tokens'

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
})

/**
 * Destino del quick action "Entrenamiento libre" (L09): no es una pantalla, es un desvío. Continúa
 * el entrenamiento abierto o abre uno nuevo y se reemplaza a sí misma, así que Atrás no vuelve acá.
 * Pinta el fondo de la app mientras tanto: sin eso el salto muestra un flash blanco.
 * `useLayoutEffect` y no `useEffect`: RN corre los de layout en el mismo commit, así que el desvío
 * entra en el mismo frame y esta View vacía no llega a dibujarse ni una vez.
 */
export default function Start() {
  useLayoutEffect(() => {
    // Igual que la pestaña de inicio: el permiso se pide al empezar el entrenamiento. Sin esto el
    // atajo se saltea el único lugar que lo pide y el diálogo aparecería recién al primer descanso,
    // justo encima de la serie que se acaba de tildar (ver `notifications.ts`).
    void ensureNotificationPermission()
    router.replace({
      params: { id: getActiveSessionId() ?? createSession() },
      pathname: '/session/[id]',
    })
  }, [])
  return <View style={styles.screen} />
}
