/**
 * Red de seguridad del rest timer: una notificación local programada al `restEndsAt` (plan §2.6).
 * No corre nada en background — la programa el sistema y la cancelamos si volvemos antes.
 *
 * Único archivo que importa `expo-notifications`: el resto de la app llama estas cuatro funciones,
 * que nunca tiran (una notificación que falla no puede romper el entrenamiento) y no hacen nada
 * si el permiso está denegado.
 */
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { t } from '@/i18n'

/** Android ≥ 8 ignora la prioridad de la notificación: manda el canal. */
const CHANNEL_ID = 'rest'

/**
 * Id fijo en vez de recordar el que devuelve `schedule`: hay un solo descanso a la vez, y así
 * cancelar funciona también después de que el proceso muriera (matar la app, o que el sistema la
 * baje). Con estado en memoria, la notificación de un descanso viejo quedaba huérfana y sonaba a
 * mitad de la serie siguiente, sin nadie que pudiera cancelarla.
 */
const NOTIFICATION_ID = 'rest-end'

let granted: boolean | null = null
/** El canal de Android, para poder esperarlo antes de programar contra él. */
let channel: Promise<unknown> = Promise.resolve()

/**
 * Todo pasa por esta cola. Tres taps rápidos en +15 s son tres reprogramaciones concurrentes: sin
 * serializar, un `cancel` puede correr antes del `schedule` que lo precedía y dejar una notificación
 * huérfana sonando a mitad del descanso. El `.catch` corta el veneno: un paso que falla no puede
 * dejar la cola rechazada para siempre.
 */
let queue: Promise<void> = Promise.resolve()
function serial(step: () => Promise<void>): Promise<void> {
  queue = queue.then(step, step).catch(() => {})
  return queue
}

/**
 * Handler de foreground: con la app abierta **no** se muestra nada (el timer en pantalla y el
 * háptico ya son el feedback; un banner encima sería ruido). Con la app en background el sistema la
 * muestra sin consultar esto. Se llama una vez desde el Gate del layout raíz.
 */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  })
  if (Platform.OS === 'android') {
    // Sin `sound`: omitirlo es el sonido default del sistema. Poniendo `'default'` el canal busca
    // un raw resource llamado así, no lo encuentra ("Custom sound 'default' not found") y se queda
    // mudo. Lo mismo vale para el `sound: true` del contenido (Android e iOS: sonido default).
    channel = Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: t('rest.title'),
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => {})
  }
}

/** iOS PROVISIONAL alcanza: la notificación llega, silenciosa, al centro de notificaciones. */
const allows = (status: Notifications.NotificationPermissionsStatus) =>
  status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL

/**
 * Se pide al empezar o continuar un entrenamiento, no al abrir la app: pedir permisos en el launch
 * es la forma más rápida de que te digan que no. Tampoco al completar la primera serie: en Android
 * el diálogo es otra Activity y las animaciones de la fila arrancarían con la app en background
 * (nunca progresan). `scheduleRestEnd` lo sigue llamando de red de seguridad — con la respuesta ya
 * cacheada es un no-op.
 *
 * ponytail: el resultado se cachea en memoria hasta que se cierra la app. Techo: si el usuario
 * habilita las notificaciones desde Ajustes con la app abierta, no nos enteramos hasta el próximo
 * arranque. Upgrade: revalidar en el `AppState` 'active'.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (granted !== null) return granted
  try {
    let status = await Notifications.getPermissionsAsync()
    if (!allows(status) && status.canAskAgain) {
      status = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true },
      })
    }
    granted = allows(status)
  } catch {
    granted = false
  }
  return granted
}

/** Cancelar un id que no está programado es un no-op, así que no hace falta saber si hay algo. */
function cancelPending(): Promise<void> {
  return Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID)
}

/**
 * Un solo descanso a la vez: reprogramar cancela el anterior. `endsAt` es epoch ms — el mismo número
 * que `session.rest_ends_at`, así que ±15 s es volver a llamar acá con el valor nuevo.
 */
export function scheduleRestEnd(endsAt: number): Promise<void> {
  return serial(async () => {
    // El canal tiene que existir antes de programar contra él: si no, en Android la notificación
    // se pierde el HIGH y el sonido que el canal define.
    await channel
    await cancelPending()
    if (!(await ensureNotificationPermission())) return
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: t('rest.notification.title'),
        body: t('rest.notification.body'),
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: endsAt,
        channelId: CHANNEL_ID,
      },
    })
  })
}

/** Saltar, llegar a cero con la app abierta, terminar o descartar: la red de seguridad ya no hace falta. */
export function cancelRestEnd(): Promise<void> {
  return serial(cancelPending)
}
