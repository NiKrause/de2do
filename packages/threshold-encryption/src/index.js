import { createAesGcmCipher } from './aes-gcm.js'
import { SessionRequiredError } from './errors.js'

const isTypedArray = (value) => Boolean(value?.subarray)

const validateKeyProvider = (keyProvider) => {
  if (keyProvider == null || typeof keyProvider.getSessionKey !== 'function') {
    throw new Error('keyProvider with getSessionKey() is required')
  }
}

const ThresholdEncryption = async ({
  keyProvider,
  keyRef = 'default',
  scope = 'data'
} = {}) => {
  validateKeyProvider(keyProvider)

  const cipher = createAesGcmCipher({ scope })
  const ivInterval = 0

  const getSessionKey = async (operation) => {
    const sessionKey = await keyProvider.getSessionKey({ keyRef, scope, operation })
    if (!sessionKey || (isTypedArray(sessionKey) && sessionKey.length === 0)) {
      throw new SessionRequiredError()
    }
    return sessionKey
  }

  const encrypt = async (value) => {
    if (!isTypedArray(value)) {
      throw new Error('Data to encrypt must be a TypedArray')
    }
    const sessionKey = await getSessionKey('encrypt')
    return cipher.encrypt(value, sessionKey)
  }

  const decrypt = async (value) => {
    if (!isTypedArray(value)) {
      throw new Error('Data to decrypt must be a TypedArray')
    }
    const sessionKey = await getSessionKey('decrypt')
    return cipher.decrypt(value, sessionKey)
  }

  return {
    encrypt,
    decrypt,
    ivInterval
  }
}

export default ThresholdEncryption
export { ThresholdEncryption }
export * from './errors.js'
export * from './key-provider.js'
