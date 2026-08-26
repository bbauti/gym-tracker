import { Stack } from 'expo-router'
import { t } from '@/i18n'

// Igual que Historial y Ejercicios: adentro de una tab nativa el large title lo da un Stack anidado.
export default function ProgressLayout() {
  return <Stack screenOptions={{ headerLargeTitle: true, title: t('tabs.progress') }} />
}
