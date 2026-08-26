// TS 6.0 ya no auto-incluye los paquetes de @types: sin esta referencia, `import ... from 'bun:test'`
// no resuelve. Alternativa (más invasiva): "types": ["bun"] en tsconfig.
/// <reference types="bun" />
