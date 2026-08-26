/**
 * Red de seguridad de los timers: una notificación local programada a la hora en la que termina lo
 * que estás esperando (plan §2.6). No corre nada en background — la programa el sistema y la
 * cancelamos si volvemos antes.
 *
 * Único archivo que importa `expo-notifications`: el resto de la app llama estas funciones, que
 * nunca tiran (una notificación que falla no puede romper el entrenamiento) y no hacen nada si el
 * permiso está denegado.
 */
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { clearRest, getSession, setRestEndsAt } from '@/db/queries/session'
import { locale, t } from '@/i18n'
import { adjustRestEndsAt } from '@/lib/rest'

/** Android ≥ 8 ignora la prioridad de la notificación: manda el canal. */
const CHANNEL_ID = 'rest'
/** C11 tiene el suyo: silenciar los avisos de descanso no puede callar también los intervalos. */
export const INTERVALS_CHANNEL_ID = 'intervals'
/** L04: la sticky informa, no avisa. LOW = sin sonido ni heads-up, y silenciable aparte. */
const SESSION_CHANNEL_ID = 'session'

const SESSION_NOTIFICATION_ID = 'session'
/** Sin `-` ni `:`: expo avisa que con esos caracteres la categoría puede no resolverse. */
const REST_CATEGORY_ID = 'sessionRest'
const SKIP_ACTION = 'skip'
const PLUS15_ACTION = 'plus15'

const timeFormat = new Intl.DateTimeFormat(locale, { timeStyle: 'short' })

/**
 * Id fijo en vez de recordar el que devuelve `schedule`: hay un solo descanso a la vez, y así
 * cancelar funciona también después de que el proceso muriera (matar la app, o que el sistema la
 * baje). Con estado en memoria, la notificación de un descanso viejo quedaba huérfana y sonaba a
 * mitad de la serie siguiente, sin nadie que pudiera cancelarla. Los intervalos (C11) hacen lo
 * mismo con el suyo.
 */
const REST_NOTIFICATION_ID = 'rest-end'

let granted: boolean | null = null
/** Los canales de Android, para poder esperarlos antes de programar contra ellos. */
let channels: Promise<unknown> = Promise.resolve()

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
  // Arranque en frío: si mataron la app con un entrenamiento abierto, su sticky quedó posteada y,
  // por `ongoing`, hasta Android 13 no se puede sacar deslizando. Nunca convive con la app en
  // pantalla — el AppState la baja al volver, y este es el "volver" que no dispara ningún evento.
  dismissSessionNotification()
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
    channels = Promise.all([
      Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: t('rest.title'),
        importance: Notifications.AndroidImportance.HIGH,
      }),
      Notifications.setNotificationChannelAsync(INTERVALS_CHANNEL_ID, {
        name: t('intervals.title'),
        importance: Notifications.AndroidImportance.HIGH,
      }),
      Notifications.setNotificationChannelAsync(SESSION_CHANNEL_ID, {
        name: t('notif.inProgress'),
        importance: Notifications.AndroidImportance.LOW,
      }),
      // Los botones de la sticky viven en una categoría, no en el contenido: sin ella la
      // notificación sale pelada, así que se espera junto con los canales antes de postear.
      Notifications.setNotificationCategoryAsync(REST_CATEGORY_ID, [
        {
          identifier: SKIP_ACTION,
          buttonTitle: t('notif.skip'),
          options: { opensAppToForeground: false },
        },
        {
          identifier: PLUS15_ACTION,
          buttonTitle: t('notif.plus15'),
          options: { opensAppToForeground: false },
        },
      ]),
    ]).catch(() => {})
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

/**
 * Una notificación a una hora fija. `id` es del que llama: reprogramar con el mismo id pisa la
 * anterior (cancelar un id que no está programado es un no-op), así que quien tiene un solo timer
 * usa siempre el mismo y no necesita recordar nada entre arranques de la app.
 *
 * `at` es epoch ms, el mismo número que la fila guarda: mover el final es volver a llamar acá.
 */
export function scheduleAt(
  id: string,
  at: number,
  title: string,
  body: string,
  channelId: string = CHANNEL_ID,
): Promise<void> {
  return serial(async () => {
    // El canal tiene que existir antes de programar contra él: si no, en Android la notificación
    // se pierde el HIGH y el sonido que el canal define.
    await channels
    await Notifications.cancelScheduledNotificationAsync(id)
    if (!(await ensureNotificationPermission())) return
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        channelId,
      },
    })
  })
}

export function cancelScheduled(id: string): Promise<void> {
  return serial(() => Notifications.cancelScheduledNotificationAsync(id))
}

/** Un solo descanso a la vez: ±15 s es volver a llamar acá con el `session.rest_ends_at` nuevo. */
export function scheduleRestEnd(endsAt: number): Promise<void> {
  return scheduleAt(
    REST_NOTIFICATION_ID,
    endsAt,
    t('rest.notification.title'),
    t('rest.notification.body'),
  )
}

/** Saltar, llegar a cero con la app abierta, terminar o descartar: la red de seguridad ya no hace falta. */
export function cancelRestEnd(): Promise<void> {
  return cancelScheduled(REST_NOTIFICATION_ID)
}

/**
 * L04 (Android): con un entrenamiento abierto y la app en background, una sola notificación pegada
 * con el estado. Id fijo, así que refrescarla es volver a llamar acá. En iOS no se postea nada: sin
 * Live Activities la sticky sería un banner más en el centro de notificaciones.
 *
 * El trigger es de 1 s y no `null` porque con `trigger: null` el nativo no sabe a qué canal mandarla
 * y cae en el canal fallback de expo (importancia default → suena). Una fecha ya pasada tampoco
 * sirve: el scheduler descarta lo que no dispara en el futuro.
 */
export function showSessionNotification(input: {
  sessionId: number
  name: string | null
  restEndsAt: number | null
}): Promise<void> {
  const { sessionId, name, restEndsAt } = input
  return serial(async () => {
    if (Platform.OS !== 'android') return
    await channels
    if (!(await ensureNotificationPermission())) return
    const resting = restEndsAt !== null && restEndsAt > Date.now()
    await Notifications.scheduleNotificationAsync({
      identifier: SESSION_NOTIFICATION_ID,
      content: {
        title: name || t('session.untitled'),
        body: resting
          ? t('notif.restUntil', { time: timeFormat.format(restEndsAt) })
          : t('notif.inProgress'),
        sound: false,
        sticky: true,
        autoDismiss: false,
        categoryIdentifier: resting ? REST_CATEGORY_ID : undefined,
        data: { sessionId, endsAt: restEndsAt },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        channelId: SESSION_CHANNEL_ID,
      },
    })
  })
}

/** Volver a la app, terminar o descartar. También cancela la programada: si volvés antes del
 *  segundo del trigger, si no aparecería recién después de haberla bajado. */
export function dismissSessionNotification(): Promise<void> {
  return serial(async () => {
    await Notifications.cancelScheduledNotificationAsync(SESSION_NOTIFICATION_ID)
    await Notifications.dismissNotificationAsync(SESSION_NOTIFICATION_ID)
  })
}

/**
 * Los botones de la sticky. Uno solo para toda la app y a nivel de módulo: en un efecto, cada Fast
 * Refresh sumaría otro. Con `opensAppToForeground: false` esto corre con la app en background (o con
 * el proceso recién levantado por el sistema), así que el `try` es en serio: si la base todavía no
 * migró, tocar el botón no puede tirar la app.
 *
 * La sesión y el final del descanso viajan en `data` porque acá no hay pantalla que los conozca.
 */
Notifications.addNotificationResponseReceivedListener((response) => {
  const action = response.actionIdentifier
  if (action !== SKIP_ACTION && action !== PLUS15_ACTION) return
  const { title, data } = response.notification.request.content
  const sessionId = data?.sessionId
  if (typeof sessionId !== 'number') return
  try {
    if (action === SKIP_ACTION) {
      clearRest(sessionId)
      cancelRestEnd()
      showSessionNotification({ sessionId, name: title, restEndsAt: null })
    } else {
      // La fila y no el `endsAt` del payload, igual que `adjustRest` en la pantalla: la sticky tarda
      // ~1 s en re-postearse, así que un doble tap leería dos veces el valor congelado y el segundo
      // pisaría al primero (+30 s quedan en +15 s). Y el piso de `adjustRestEndsAt` evita lo peor:
      // sobre un descanso ya vencido, sumar al valor viejo escribiría una fecha pasada, que el
      // scheduler descarta y deja la sticky sin botones — el botón de estirar terminaba el descanso.
      const current = getSession(sessionId)?.restEndsAt
      if (current == null) return
      const endsAt = adjustRestEndsAt(current, 15_000, Date.now())
      setRestEndsAt(sessionId, endsAt)
      scheduleRestEnd(endsAt)
      showSessionNotification({ sessionId, name: title, restEndsAt: endsAt })
    }
  } catch {
    // Un botón que falla deja el descanso como estaba; nada que mostrar sin app en pantalla.
  }
})
