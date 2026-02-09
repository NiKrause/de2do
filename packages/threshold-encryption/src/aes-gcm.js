import { DecryptFailedError, UnsupportedCipherVersionError } from './errors.js'

const VERSION = 1
const ALGORITHM_ID = 1
const SALT_LENGTH = 16
const NONCE_LENGTH = 12
const DERIVED_KEY_LENGTH = 32

const HEADER_LENGTH = 2 + SALT_LENGTH + NONCE_LENGTH

const getCrypto = () => {
  if (globalThis.crypto?.subtle) return globalThis.crypto
  throw new Error('WebCrypto is required')
}

const concat = (chunks) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

const toUint8Array = (value) => {
  if (!value?.subarray) throw new TypeError('Value must be a TypedArray')
  return value
}

const encodeInfo = (scope) => {
  const tag = `orbitdb-threshold-encryption:${scope}`
  return new TextEncoder().encode(tag)
}

const deriveAesKey = async ({ sessionKey, salt, scope }) => {
  const crypto = getCrypto()
  const keyInput = typeof sessionKey === 'string' ? new TextEncoder().encode(sessionKey) : sessionKey
  if (!keyInput?.subarray || keyInput.length === 0) {
    throw new TypeError('Session key must be a non-empty String or TypedArray')
  }

  const baseKey = await crypto.subtle.importKey('raw', keyInput, 'HKDF', false, ['deriveBits'])
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: encodeInfo(scope)
    },
    baseKey,
    DERIVED_KEY_LENGTH * 8
  )
  return crypto.subtle.importKey(
    'raw',
    derivedBits,
    {
      name: 'AES-GCM'
    },
    false,
    ['encrypt', 'decrypt']
  )
}

export const createAesGcmCipher = ({ scope = 'data' } = {}) => {
  const crypto = getCrypto()

  const encrypt = async (data, sessionKey) => {
    const plaintext = toUint8Array(data)
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH))
    const aesKey = await deriveAesKey({ sessionKey, salt, scope })
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext)

    return concat([
      Uint8Array.from([VERSION, ALGORITHM_ID]),
      salt,
      nonce,
      new Uint8Array(ciphertext)
    ])
  }

  const decrypt = async (data, sessionKey) => {
    const payload = toUint8Array(data)
    if (payload.length < HEADER_LENGTH + 1) {
      throw new DecryptFailedError('Ciphertext payload is too short')
    }

    const version = payload[0]
    const algorithm = payload[1]
    if (version !== VERSION || algorithm !== ALGORITHM_ID) {
      throw new UnsupportedCipherVersionError()
    }

    const salt = payload.subarray(2, 2 + SALT_LENGTH)
    const nonce = payload.subarray(2 + SALT_LENGTH, 2 + SALT_LENGTH + NONCE_LENGTH)
    const ciphertext = payload.subarray(2 + SALT_LENGTH + NONCE_LENGTH)
    const aesKey = await deriveAesKey({ sessionKey, salt, scope })

    try {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext)
      return new Uint8Array(plaintext)
    } catch {
      throw new DecryptFailedError()
    }
  }

  return {
    encrypt,
    decrypt
  }
}
