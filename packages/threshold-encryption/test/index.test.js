import test from 'node:test'
import assert from 'node:assert/strict'

import ThresholdEncryption, {
  createMutableSessionKeyProvider,
  createStaticKeyProvider,
  SessionRequiredError,
  UnsupportedCipherVersionError
} from '../src/index.js'

test('encrypts and decrypts a typed array', async () => {
  const keyProvider = createStaticKeyProvider({ key: 'session-key-1' })
  const encryption = await ThresholdEncryption({ keyProvider, scope: 'data' })
  const plain = new TextEncoder().encode('hello threshold encryption')

  const ciphertext = await encryption.encrypt(plain)
  const decrypted = await encryption.decrypt(ciphertext)

  assert.deepEqual(decrypted, plain)
})

test('generates distinct ciphertext for same plaintext', async () => {
  const keyProvider = createStaticKeyProvider({ key: 'session-key-1' })
  const encryption = await ThresholdEncryption({ keyProvider, scope: 'replication' })
  const plain = new TextEncoder().encode('same payload')

  const ciphertext1 = await encryption.encrypt(plain)
  const ciphertext2 = await encryption.encrypt(plain)

  assert.notDeepEqual(ciphertext1, ciphertext2)
})

test('throws for non-typed-array input', async () => {
  const keyProvider = createStaticKeyProvider({ key: 'session-key-1' })
  const encryption = await ThresholdEncryption({ keyProvider })

  await assert.rejects(() => encryption.encrypt('hello'), {
    message: 'Data to encrypt must be a TypedArray'
  })
  await assert.rejects(() => encryption.decrypt('hello'), {
    message: 'Data to decrypt must be a TypedArray'
  })
})

test('throws SessionRequiredError when session key is missing', async () => {
  const keyProvider = createMutableSessionKeyProvider()
  const encryption = await ThresholdEncryption({ keyProvider })
  const plain = new TextEncoder().encode('payload')

  await assert.rejects(() => encryption.encrypt(plain), SessionRequiredError)
})

test('throws UnsupportedCipherVersionError for unknown header version', async () => {
  const keyProvider = createStaticKeyProvider({ key: 'session-key-1' })
  const encryption = await ThresholdEncryption({ keyProvider })
  const plain = new TextEncoder().encode('payload')
  const ciphertext = await encryption.encrypt(plain)

  ciphertext[0] = 99
  await assert.rejects(() => encryption.decrypt(ciphertext), UnsupportedCipherVersionError)
})
