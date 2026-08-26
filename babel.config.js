module.exports = (api) => {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'], // already wires react-native-worklets/plugin and the React Compiler
    plugins: [['inline-import', { extensions: ['.sql'] }]], // drizzle migrations
  }
}
