# @local/orbitdb-threshold-encryption

SimpleEncryption-compatible encryption factory for OrbitDB using session keys from an external key provider.

## Status

Scaffold implementation for Milestone 1:

- `encrypt/decrypt` API compatible with OrbitDB encryption hooks
- AES-GCM with per-record random nonce
- HKDF-derived record keys from session key + salt + scope
- key-provider abstraction for session control

## Usage

```js
import ThresholdEncryption, { createStaticKeyProvider } from '@local/orbitdb-threshold-encryption'

const keyProvider = createStaticKeyProvider({ key: 'dev-session-key' })
const replication = await ThresholdEncryption({
  keyProvider,
  keyRef: 'db:my-list',
  scope: 'replication'
})

const encryption = { replication }
```

## Test

```bash
npm --prefix packages/threshold-encryption test
```
