import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'

export type HapticEvent =
  | 'setComplete'
  | 'setUncomplete'
  | 'exerciseDone'
  | 'success'
  | 'selection'
  | 'snap'
  | 'thresholdIn'
  | 'thresholdOut'
  | 'delete'
  | 'undo'
  | 'dragStart'
  | 'dragSlot'
  | 'dragDrop'
  | 'detent'
  | 'toggle'
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
  selection: () => Haptics.selectionAsync(),
  snap: () => Haptics.impactAsync(Impact.Soft),
  thresholdIn: () => Haptics.impactAsync(Impact.Rigid),
  thresholdOut: () => Haptics.impactAsync(Impact.Soft),
  delete: () => Haptics.notificationAsync(Notify.Warning),
  undo: () => Haptics.impactAsync(Impact.Light),
  dragStart: () => Haptics.impactAsync(Impact.Medium),
  dragSlot: () => Haptics.selectionAsync(),
  dragDrop: () => Haptics.impactAsync(Impact.Light),
  detent: () => Haptics.impactAsync(Impact.Soft),
  toggle: () => Haptics.impactAsync(Impact.Light),
  error: () => Haptics.notificationAsync(Notify.Error),
}

const android: Record<HapticEvent, Haptics.AndroidHaptics> = {
  setComplete: Android.Confirm,
  setUncomplete: Android.Toggle_Off,
  exerciseDone: Android.Confirm,
  success: Android.Confirm,
  selection: Android.Clock_Tick,
  snap: Android.Segment_Tick,
  thresholdIn: Android.Segment_Tick,
  thresholdOut: Android.Segment_Tick,
  delete: Android.Reject,
  undo: Android.Confirm,
  dragStart: Android.Drag_Start,
  dragSlot: Android.Segment_Tick,
  dragDrop: Android.Gesture_End,
  detent: Android.Gesture_End,
  // ponytail: HapticEvent tiene un solo 'toggle', así que Android siempre recibe Toggle_On.
  // Techo: apagar un switch vibra igual que encenderlo. Upgrade: agregar 'toggleOff' al union.
  toggle: Android.Toggle_On,
  error: Android.Reject,
}

const GLOBAL_GATE_MS = 50
const EVENT_GATE_MS = 300

let enabled = true
let lastAt = 0
const lastByEvent = new Map<HapticEvent, number>()

export function setHapticsEnabled(on: boolean): void {
  enabled = on
}

export function haptic(event: HapticEvent): void {
  if (!enabled) return
  const now = Date.now()
  if (now - lastAt < GLOBAL_GATE_MS) return
  if (now - (lastByEvent.get(event) ?? Number.NEGATIVE_INFINITY) < EVENT_GATE_MS) return
  lastAt = now
  lastByEvent.set(event, now)
  const fired =
    Platform.OS === 'ios'
      ? ios[event]()
      : Platform.OS === 'android'
        ? Haptics.performAndroidHapticsAsync(android[event])
        : null
  fired?.catch(() => {})
}
