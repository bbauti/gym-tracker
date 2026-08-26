import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { StyleSheet, View } from 'react-native'
import Button from './Button'
import Text from './Text'
import { colors, spacing } from './tokens'

type Props = {
  sf?: string
  /** Material Symbol equivalente; sin esto SymbolView no dibuja nada en Android. */
  md?: string
  title: string
  description?: string
  action?: { title: string; onPress: () => void }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
  },
  centered: { textAlign: 'center' },
})

export default function EmptyState({ sf, md, title, description, action }: Props) {
  return (
    <View style={styles.wrap}>
      {sf ? (
        <SymbolView
          fallback={null}
          name={{ ios: sf as SFSymbol, android: md as AndroidSymbol }}
          size={44}
          tintColor={colors.tertiaryLabel}
        />
      ) : null}
      <Text role="headline" style={styles.centered}>
        {title}
      </Text>
      {description ? (
        <Text color="secondary" style={styles.centered}>
          {description}
        </Text>
      ) : null}
      {action ? <Button onPress={action.onPress} title={action.title} variant="tinted" /> : null}
    </View>
  )
}
