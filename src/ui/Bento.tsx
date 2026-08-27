import { Children, isValidElement, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { spacing } from './tokens'

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing[3] },
  span1: { flex: 1 },
  span2: { flex: 2 },
})

/**
 * Fila del bento (§12.4). Cada hijo va en una celda con `flex` = su `span`: el ancho sale de la
 * proporción y no del contenido — dos tiles con textos de largo distinto quedan iguales — y el alto
 * de la celda lo estira la fila, así los tiles de una misma fila terminan parejos.
 */
function Row({ children }: { children: ReactNode }) {
  return (
    <View style={styles.row}>
      {Children.map(children, (child) =>
        isValidElement<{ span?: 1 | 2 }>(child) ? (
          <View style={child.props.span === 2 ? styles.span2 : styles.span1}>{child}</View>
        ) : (
          child
        ),
      )}
    </View>
  )
}

const Bento = { Row }
export default Bento
