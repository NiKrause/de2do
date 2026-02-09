# API Spec

## Package Name (working)

`@local/orbitdb-threshold-encryption`

## Core Factory

```js
const enc = await ThresholdEncryption({
  mode: 'data' | 'replication',
  keyProvider,            // threshold/session key provider
  keyRef,                 // db-scoped key identifier
  sessionTtlMs,           // optional
  aadContext              // optional associated-data context
})
```

Returns:

```js
{
  encrypt: async (value: Uint8Array) => Uint8Array,
  decrypt: async (value: Uint8Array) => Uint8Array,
  ivInterval: number
}
```

The surface intentionally mirrors `SimpleEncryption`.

## Key Provider Interface

```js
{
  getSessionKey: async ({ keyRef, mode }) => CryptoKey | Uint8Array,
  ensureSession: async ({ keyRef, mode }) => void,
  clearSession: async ({ keyRef }) => void
}
```

Notes:
- No password argument in encrypt/decrypt calls.
- Session material is acquired by threshold-authenticated unlock flow.

## Cipher Format v1

`version(1) | alg(1) | salt(16) | nonce(12) | ciphertext+tag(n)`

- `version`: `0x01`
- `alg`: `0x01` for AES-GCM-256
- `salt`: HKDF/derivation salt for per-record subkeys
- `nonce`: per-record random nonce, never reused with same subkey

## OrbitDB Usage

### Data Encryption

```js
const data = await ThresholdEncryption({ mode: 'data', keyProvider, keyRef })
const encryption = { data }
```

### Oplog/Replication Encryption

```js
const replication = await ThresholdEncryption({ mode: 'replication', keyProvider, keyRef })
const encryption = { replication }
```

### Both

```js
const encryption = { data, replication }
```

## Configuration Metadata

Store alongside todo-list registry:

- `encryptionMethod: 'threshold-v1'`
- `thresholdPolicy: { n: 3, t: 2 }`
- `keyRef`
- `encryptionScopes: ['data', 'replication']`
- `epoch`
