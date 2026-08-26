const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.resolver.sourceExts.push('sql') // drizzle migrations are imported as text
module.exports = config
