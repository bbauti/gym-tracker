import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'

export type HapticEvent =
  | 'setComplete'
  | 'setUncomplete'
  | 'exerciseDone'
  | 'success'
  | 'finish'
  | 'pr'
  | 'selection'
  | 'tabChange'
  | 'pickerChange'
  | 'tick'
  | 'sessionStart'
  | 'buttonPrimary'
  | 'sheetOpen'
  | 'sheetClose'
  | 'thresholdIn'
  | 'thresholdOut'
  | 'delete'
  | 'undo'
  | 'dragStart'
  | 'dragSlot'
  | 'dragDrop'
  | 'toggle'
  | 'toggleOff'
  | 'error'

const {
  ImpactFeedbackStyle: Impact,
  NotificationFeedbackType: Notify,
  AndroidHaptics: Android,
} = Haptics

const ios: Record<HapticEvent, () => Promise<void>> = {
  setComplete: () => Haptics.impactAsync(Impact.Light),
  setUncomplete: () => Haptics.impactAsync(Impact.Soft),
  exerciseDone: () => Haptics.impactAsync(Impact.Medium),
  success: () => Haptics.notificationAsync(Notify.Success),
  finish: () => Haptics.notificationAsync(Notify.Success),
  pr: () => Haptics.impactAsync(Impact.Rigid),
  selection: () => Haptics.selectionAsync(),
  tabChange: () => Haptics.selectionAsync(),
  pickerChange: () => Haptics.selectionAsync(),
  tick: () => Haptics.impactAsync(Impact.Light),
  sessionStart: () => Haptics.impactAsync(Impact.Medium),
  buttonPrimary: () => Haptics.impactAsync(Impact.Light),
  sheetOpen: () => Haptics.impactAsync(Impact.Soft),
  sheetClose: () => Haptics.impactAsync(Impact.Soft),
  thresholdIn: () => Haptics.impactAsync(Impact.Rigid),
  thresholdOut: () => Haptics.impactAsync(Impact.Soft),
  delete: () => Haptics.notificationAsync(Notify.Warning),
  undo: () => Haptics.impactAsync(Impact.Light),
  dragStart: () => Haptics.impactAsync(Impact.Medium),
  dragSlot: () => Haptics.selectionAsync(),
  dragDrop: () => Haptics.impactAsync(Impact.Light),
  toggle: () => Haptics.impactAsync(Impact.Light),
  toggleOff: () => Haptics.impactAsync(Impact.Soft),
  error: () => Haptics.notificationAsync(Notify.Error),
}

const android: Record<HapticEvent, Haptics.AndroidHaptics> = {
  setComplete: Android.Confirm,
  setUncomplete: Android.Toggle_Off,
  exerciseDone: Android.Confirm,
  success: Android.Confirm,
  finish: Android.Confirm,
  pr: Android.Confirm,
  selection: Android.Clock_Tick,
  tabChange: Android.Clock_Tick,
  pickerChange: Android.Segment_Tick,
  tick: Android.Clock_Tick,
  sessionStart: Android.Confirm,
  // El háptico canónico de "apreté un botón" en Android; `Confirm` acá sería un final, no un inicio.
  buttonPrimary: Android.Virtual_Key,
  sheetOpen: Android.Gesture_End,
  sheetClose: Android.Gesture_End,
  thresholdIn: Android.Segment_Tick,
  thresholdOut: Android.Segment_Tick,
  delete: Android.Reject,
  undo: Android.Confirm,
  dragStart: Android.Drag_Start,
  dragSlot: Android.Segment_Tick,
  dragDrop: Android.Gesture_End,
  toggle: Android.Toggle_On,
  toggleOff: Android.Toggle_Off,
  error: Android.Reject,
}

/**
 * Los dos eventos que son un golpe doble: un PR y el fin del entrenamiento pasan pocas veces por
 * semana, así que se ganan un patrón propio en vez de un impacto más (§12.3). El segundo golpe sale
 * por `setTimeout` porque `expo-haptics` no encola patrones.
 */
const SEQUENCES: Partial<
  Record<HapticEvent, { delay: number; ios: () => Promise<void>; android: Haptics.AndroidHaptics }>
> = {
  pr: { delay: 90, ios: () => Haptics.impactAsync(Impact.Rigid), android: Android.Segment_Tick },
  finish: { delay: 150, ios: () => Haptics.impactAsync(Impact.Soft), android: Android.Gesture_End },
}

const GLOBAL_GATE_MS = 50
const EVENT_GATE_MS = 300

let enabled = true
let lastAt = 0
const lastByEvent = new Map<HapticEvent, number>()

export function setHapticsEnabled(on: boolean): void {
  enabled = on
}

function play(effect: () => Promise<void>, androidEffect: Haptics.AndroidHaptics): void {
  const fired =
    Platform.OS === 'ios'
      ? effect()
      : Platform.OS === 'android'
        ? Haptics.performAndroidHapticsAsync(androidEffect)
        : null
  fired?.catch(() => {})
}

export function haptic(event: HapticEvent): void {
  if (!enabled) return
  const now = Date.now()
  if (now - lastAt < GLOBAL_GATE_MS) return
  if (now - (lastByEvent.get(event) ?? Number.NEGATIVE_INFINITY) < EVENT_GATE_MS) return
  lastAt = now
  lastByEvent.set(event, now)
  play(ios[event], android[event])
  const seq = SEQUENCES[event]
  // La secuencia se gatea como una sola cosa: el gate global es de 50 ms y el segundo golpe cae
  // antes, así que si volviera a pasar por `haptic()` nunca sonaría. Se relee `enabled` por si
  // apagaron los hápticos entre medio.
  if (seq) setTimeout(() => enabled && play(seq.ios, seq.android), seq.delay)
}
