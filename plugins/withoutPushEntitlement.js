// expo-notifications agrega `aps-environment` (push remoto) sin opción para no hacerlo. La app solo
// usa notificaciones locales y un Personal Team gratuito no puede firmar esa capability.
const { withEntitlementsPlist } = require('@expo/config-plugins')

module.exports = (config) =>
  withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment']
    return c
  })
