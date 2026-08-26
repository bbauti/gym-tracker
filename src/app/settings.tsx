import { Children, type ReactNode, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native'
import {
  BackupError,
  type BackupInfo,
  backupNow,
  exportCsv,
  exportDatabase,
  exportJson,
  listBackups,
  restoreFromBackup,
  restoreFromFile,
  wipeAll,
} from '@/db/backup'
import { locale, t } from '@/i18n'
import { type HapticEvent, haptic } from '@/ui/haptics'
import ListRow from '@/ui/ListRow'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { paddingVertical: spacing[4], paddingHorizontal: spacing[4] },
  sections: { gap: spacing[5] },
  dimmed: { opacity: 0.7 },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: spacing[2],
    paddingBottom: spacing[2],
  },
  group: { borderRadius: radius.md, overflow: 'hidden' },
  // El separador de la última fila cae fuera del recorte del grupo: ListRow lo dibuja siempre.
  lastRow: { marginBottom: -StyleSheet.hairlineWidth },
  dangerBox: { paddingLeft: spacing[4], backgroundColor: colors.secondaryGroupedBackground },
  dangerRow: {
    minHeight: MIN_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingRight: spacing[4],
    paddingVertical: spacing[2],
  },
  dangerLabel: { flex: 1 },
})

// ponytail: unidades abreviadas (min/h/d) — no se flexionan ni en es ni en en, así que no hace falta
// plural(). Techo: nunca dice "hace 3 días". Upgrade: keys .one/.other por unidad si molesta.
function relativeTime(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000))
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.minutesAgo', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('time.hoursAgo', { n: hours })
  return t('time.daysAgo', { n: Math.round(hours / 24) })
}

function formatSize(bytes: number): string {
  const kb = bytes / 1024
  return kb < 1024
    ? `${numberFormat.format(Math.round(kb))} kB`
    : `${numberFormat.format(kb / 1024)} MB`
}

function errorMessage(error: unknown): string {
  return error instanceof BackupError
    ? t(`backup.error.${error.code}`)
    : t('backup.error.unsupported')
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const last = Children.count(children) - 1
  return (
    <View>
      <Text
        accessibilityRole="header"
        color="secondary"
        role="footnote"
        style={styles.sectionTitle}
      >
        {title}
      </Text>
      <View style={styles.group}>
        {Children.map(children, (child, i) => (
          <View style={i === last ? styles.lastRow : null}>{child}</View>
        ))}
      </View>
    </View>
  )
}

/** ListRow no tiene variante destructiva y `ui/` es de otro slice: misma caja, label en rojo. */
function DangerRow({
  title,
  trailing,
  onPress,
}: {
  title: string
  trailing?: ReactNode
  onPress?: () => void
}) {
  const content = (
    <View style={styles.dangerRow}>
      <Text color="destructive" numberOfLines={1} style={styles.dangerLabel}>
        {title}
      </Text>
      {trailing}
    </View>
  )
  if (!onPress)
    return (
      <View accessible accessibilityLabel={title} style={styles.dangerBox}>
        {content}
      </View>
    )
  return (
    <PressableScale
      accessibilityLabel={title}
      onPress={onPress}
      scale={0.98}
      style={styles.dangerBox}
    >
      {content}
    </PressableScale>
  )
}

/** Restaurar pisa todos los datos: se pregunta antes de tocar nada (y antes de abrir el picker). */
function confirmRestore(onConfirm: () => void) {
  Alert.alert(t('settings.restoreConfirm.title'), t('settings.restoreConfirm.body'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('settings.restoreConfirm.action'), style: 'destructive', onPress: onConfirm },
  ])
}

type AlertMsg = { title: string; body?: string }

export default function SettingsScreen() {
  const [busy, setBusy] = useState<string | null>(null)
  // Los backups son archivos, no filas: ningún change listener los ve, se re-listan a mano.
  const [backups, setBackups] = useState<BackupInfo[]>(listBackups)

  /** `action` devuelve el mensaje del Alert, o null si no hay nada que anunciar. */
  async function run(
    id: string,
    action: () => AlertMsg | null | Promise<AlertMsg | null>,
    tone: HapticEvent = 'success',
  ) {
    if (busy) return
    setBusy(id)
    try {
      const message = await action()
      if (message !== null) {
        haptic(tone)
        Alert.alert(message.title, message.body)
      }
    } catch (error) {
      haptic('error')
      Alert.alert(t('error.title'), errorMessage(error))
    } finally {
      setBusy(null)
      setBackups(listBackups())
    }
  }

  // Sin onPress, ListRow deja de ser pressable: eso es "deshabilitado" mientras corre una operación.
  const press = (
    id: string,
    action: () => AlertMsg | null | Promise<AlertMsg | null>,
    tone?: HapticEvent,
  ) =>
    busy
      ? undefined
      : () => {
          void run(id, action, tone)
        }

  const spinner = (id: string) => (busy === id ? <ActivityIndicator /> : undefined)

  /** Atenúa las filas inactivas: la que corre queda legible, y su spinner también. */
  const dim = (id: string) => (busy !== null && busy !== id ? styles.dimmed : null)

  const restoreBackup = (backup: BackupInfo) => () =>
    confirmRestore(() => {
      void run(backup.path, () => {
        restoreFromBackup(backup.path)
        return { title: t('backup.done.restore') }
      })
    })

  const restoreFile = () =>
    confirmRestore(() => {
      void run('file', async () =>
        (await restoreFromFile()) ? { title: t('backup.done.restore') } : null,
      )
    })

  function confirmWipe() {
    Alert.alert(t('settings.wipeConfirm.title'), t('settings.wipeConfirm.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.wipeConfirm.action'),
        style: 'destructive',
        onPress: () => {
          void run(
            'wipe',
            () => {
              wipeAll()
              return { title: t('settings.wipeDone.title'), body: t('settings.wipeDone.body') }
            },
            'delete',
          )
        },
      },
    ])
  }

  const last: BackupInfo | undefined = backups[0]

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
    >
      <View style={styles.sections}>
        {/* Exportar abre la hoja de compartir: esa hoja ES el feedback. shareAsync también resuelve
            cuando la cancelan, así que un Alert de éxito acá mentiría la mitad de las veces. */}
        <Section title={t('settings.export')}>
          <View style={dim('db')}>
            <ListRow
              onPress={press('db', async () => {
                await exportDatabase()
                return null
              })}
              title={t('settings.exportDb')}
              trailing={spinner('db')}
            />
          </View>
          <View style={dim('json')}>
            <ListRow
              onPress={press('json', async () => {
                await exportJson()
                return null
              })}
              title={t('settings.exportJson')}
              trailing={spinner('json')}
            />
          </View>
          <View style={dim('csv')}>
            <ListRow
              onPress={press('csv', async () => {
                await exportCsv()
                return null
              })}
              title={t('settings.exportCsv')}
              trailing={spinner('csv')}
            />
          </View>
        </Section>

        <Section title={t('settings.backups')}>
          <View style={dim('backup')}>
            <ListRow
              onPress={press('backup', () => {
                backupNow()
                // El subtítulo pasa a "recién": alcanza como feedback, el háptico lo acompaña.
                haptic('success')
                return null
              })}
              subtitle={
                last
                  ? t('settings.lastBackup', { when: relativeTime(last.modifiedAt) })
                  : t('settings.noBackup')
              }
              title={t('settings.backupNow')}
              trailing={spinner('backup')}
            />
          </View>
        </Section>

        <Section title={t('settings.restore')}>
          <View style={dim('file')}>
            <ListRow
              onPress={busy ? undefined : restoreFile}
              title={t('settings.restoreFile')}
              trailing={spinner('file')}
            />
          </View>
          {backups.map((backup) => (
            <View key={backup.path} style={dim(backup.path)}>
              <ListRow
                onPress={busy ? undefined : restoreBackup(backup)}
                subtitle={formatSize(backup.size)}
                title={dateFormat.format(new Date(backup.modifiedAt))}
                trailing={spinner(backup.path)}
              />
            </View>
          ))}
        </Section>

        <Section title={t('settings.danger')}>
          <View style={dim('wipe')}>
            <DangerRow
              onPress={busy ? undefined : confirmWipe}
              title={t('settings.wipe')}
              trailing={spinner('wipe')}
            />
          </View>
        </Section>
      </View>
    </ScrollView>
  )
}
