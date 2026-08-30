import { TextDecoder, TextEncoder } from 'node:util'
import { webcrypto } from 'node:crypto'

Object.assign(globalThis, { TextEncoder, TextDecoder })

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  })
}

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T
}
