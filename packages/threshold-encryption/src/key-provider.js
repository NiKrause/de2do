import { SessionRequiredError } from './errors.js'

const toUint8Array = (key) => {
  if (key == null) return null
  if (typeof key === 'string') return new TextEncoder().encode(key)
  if (key?.subarray) return key
  throw new TypeError('Session key must be a String or a TypedArray')
}

export const createStaticKeyProvider = ({ key }) => {
  const sessionKey = toUint8Array(key)

  return {
    async ensureSession () {
      if (!sessionKey || sessionKey.length === 0) {
        throw new SessionRequiredError()
      }
    },
    async getSessionKey () {
      if (!sessionKey || sessionKey.length === 0) {
        return null
      }
      return sessionKey
    },
    async clearSession () {
      // no-op for static provider
    }
  }
}

export const createMutableSessionKeyProvider = () => {
  let sessionKey = null

  return {
    async ensureSession () {
      if (!sessionKey || sessionKey.length === 0) {
        throw new SessionRequiredError()
      }
    },
    async getSessionKey () {
      return sessionKey
    },
    async setSessionKey (key) {
      sessionKey = toUint8Array(key)
    },
    async clearSession () {
      sessionKey = null
    }
  }
}
