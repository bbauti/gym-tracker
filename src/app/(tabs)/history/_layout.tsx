import { Stack } from 'expo-router'
import { t } from '@/i18n'

// Igual que Ejercicios: dentro de una tab nativa el único que da header (y large title) es un
// Stack anidado. Sin esto la pantalla arranca pegada al notch y sin título.
export default function HistoryLayout() {
  return <Stack screenOptions={{ headerLargeTitle: true, title: t('tabs.history') }} />
}
