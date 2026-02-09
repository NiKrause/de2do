# Implementation Plan

## Phase 0: Design Freeze

1. Finalize encryption scopes:
   - MVP-A: `replication` only (oplog)
   - MVP-B: `data + replication`
2. Finalize policy:
   - default `2-of-3` (desktop, phone-a, phone-b)
3. Finalize wire format and metadata schema.

Deliverable:
- agreed spec (`API_SPEC.md`) and task list (`WORK_ITEMS.md`)

## Phase 1: Package Skeleton

Create `packages/orbitdb-threshold-encryption/`:

1. `src/index.js` exporting `ThresholdEncryption()`
2. `src/aes-gcm.js` implementing per-record random nonce + authenticated encryption
3. `src/key-provider.js` abstraction for session key retrieval
4. `src/errors.js` typed errors:
   - `SessionRequiredError`
   - `DecryptFailedError`
   - `UnsupportedCipherVersionError`

Deliverable:
- package compiles and local unit tests pass for encrypt/decrypt roundtrip

## Phase 2: Threshold Session-Key Control (Prototype)

1. Implement a prototype key provider:
   - `src/lib/encryption/threshold/key-provider.js`
2. Session unlock flow:
   - desktop requests unlock token/challenge
   - phone-a or phone-b contributes approval/share
   - desktop receives short-lived session key handle
3. Session lifecycle:
   - TTL-based expiration
   - manual clear/lock

Deliverable:
- no password required for open/encrypt/decrypt in unlocked session

## Phase 3: OrbitDB Integration

Integrate into app:

1. `src/lib/p2p.js`
   - support `encryptionMethod === 'threshold-v1'`
   - construct `encryption` object for `data` and/or `replication`
2. `src/lib/encryption-migration.js`
   - support migration into threshold mode
3. `src/lib/handlers/encryption-handlers.js`
   - trigger threshold enrollment/unlock instead of password prompt
4. `src/lib/components/encryption/EncryptionSettings.svelte`
   - add method selector and onboarding for `threshold-v1`
5. `src/lib/components/encryption/CeremonyStatus.svelte`
   - render per-device ceremony progress on each browser
6. `src/lib/ceremony/ceremony-status-store.js`
   - normalize ceremony events into shared UI state

Deliverable:
- database open, read, write with threshold mode from UI flow

## Phase 4: Secure DKG Example (Improved)

Create example under `examples/orbitdb-threshold-dkg/`:

1. Clear demo boundaries:
   - mark demo vs production-safe parts explicitly
2. No fake share "encryption":
   - use proper authenticated wrapping between peers
3. Separate protocol roles:
   - coordinator messaging over OrbitDB
   - crypto operations in dedicated module
4. Include share-rotation and recovery flow (device loss).

Deliverable:
- runnable example with deterministic tests, explicit threat limits

## Phase 5: Testing and Hardening

1. Unit tests:
   - cipher format/version checks
   - key/session expiration
   - decrypt failure behavior
2. Integration tests:
   - open encrypted db with `replication` only
   - open encrypted db with `data + replication`
   - migration unencrypted -> threshold encrypted
3. E2E tests:
   - session unlock required on fresh load
   - no password modal for threshold mode
   - recovery path using backup phone
   - ceremony status consistency across three browsers

Deliverable:
- CI green for unit/integration/e2e target matrix

## Phase 6: Rollout

1. Feature flag: `thresholdEncryptionEnabled`
2. Backward compatibility:
   - keep existing password and webauthn modes
3. telemetry/debug logs:
   - unlock attempts
   - decrypt failures
   - session expiry events

Deliverable:
- staged rollout with rollback path
