import { Stack } from 'expo-router'
import { t } from '@/i18n'

// El Stack anidado es lo que habilita headerSearchBarOptions dentro de una tab nativa.
export default function ExercisesLayout() {
  return <Stack screenOptions={{ headerLargeTitle: true, title: t('tabs.exercises') }} />
}
