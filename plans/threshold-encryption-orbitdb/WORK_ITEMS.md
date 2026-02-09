# Work Items

## Milestone 1: Package Foundation

1. Create `packages/orbitdb-threshold-encryption/package.json`
2. Implement `src/index.js` with SimpleEncryption-compatible factory.
3. Implement AES-GCM with random nonce per record.
4. Add unit tests for roundtrip and malformed inputs.

Acceptance:
- API parity with existing usage expectations in `src/lib/p2p.js`.

## Milestone 2: Key Provider and Session Control

1. Implement `getSessionKey/ensureSession/clearSession`.
2. Add session TTL and expiration events.
3. Add lock on tab close/navigation (best effort).

Acceptance:
- encryption operations fail with `SessionRequiredError` when locked.

## Milestone 3: App Integration

1. Update `src/lib/p2p.js` to support:
   - `encryptionMethod: 'threshold-v1'`
   - scopes: `replication`, `data`, `both`
2. Update `src/lib/encryption-migration.js` to create threshold encryption instances.
3. Update `src/lib/handlers/encryption-handlers.js` for threshold enrollment/open flow.
4. Update `src/lib/components/encryption/EncryptionSettings.svelte` with new option.
5. Add ceremony state store:
   - `src/lib/ceremony/ceremony-status-store.js`
6. Add ceremony panel:
   - `src/lib/components/encryption/CeremonyStatus.svelte`

Acceptance:
- local app can create/open threshold-encrypted db without password prompt.
- each browser shows ceremony progress (`joined`, `verified`, `ready`).

## Milestone 4: Recovery and Rotation

1. Define backup package format:
   - wrapped share
   - keyRef
   - epoch
2. Implement rotation command path for lost device.
3. Implement backup restore flow with second phone.

Acceptance:
- one-device-loss recovery passes integration tests.

## Milestone 5: DKG Demo Refresh

1. Add `examples/orbitdb-threshold-dkg/`.
2. Separate demo protocol state and crypto primitives.
3. Add explicit warnings and production limitations.
4. Add test vectors and deterministic test mode.

Acceptance:
- demo can be executed end-to-end with clear logs and pass/fail assertions.

## Milestone 6: E2E Coverage

1. Add new e2e suite:
   - `e2e/encryption-threshold.spec.js`
2. Add migration coverage:
   - unencrypted -> threshold
   - password -> threshold (optional)
3. Add negative tests:
   - expired session
   - wrong backup package
   - replayed old epoch data
4. Add multi-browser status tests:
   - 3-browser ceremony view shows same completion state
   - offline device transition reflected in UI

Acceptance:
- CI passes with stable tests and no password-based unlock dependency for threshold mode.
