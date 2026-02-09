# Threshold Ceremony (3 Browsers via js-libp2p)

This document describes the intended ceremony for threshold-controlled encryption/decryption using three browser devices:

- `desktop` (daily driver)
- `phone-a` (primary second factor)
- `phone-b` (backup/recovery factor)

Target policy: `2-of-3`.

## Scope

Applies to threshold encryption mode (`threshold-v1`) planned in this repo:

- OrbitDB `encryption.data`
- OrbitDB `encryption.replication` (oplog encryption)

## Status

- Package scaffold exists: `packages/threshold-encryption/`
- App wiring in progress.
- Full ceremony automation is not fully implemented yet.

Use this as the implementation runbook and UX/protocol reference.

## Preconditions

1. Three browser contexts can connect over js-libp2p (direct or relay).
2. All devices can open the same ceremony coordination DB address.
3. Feature flag enabled for threshold mode:
   - `VITE_ENABLE_THRESHOLD_ENCRYPTION=true`
4. Each device has a stable device identity (`deviceId`) for the ceremony.

## Terms

- `keyRef`: DB-scoped key identifier (example: `db:<dbName>`).
- `epoch`: key generation/rotation version number.
- `wrappedShare`: encrypted share payload for a specific device.
- `sessionKey`: short-lived in-memory key material used for local encrypt/decrypt calls.
- `ceremonyState`: replicated + live status model used by all 3 browsers to render progress.

## High-Level Flow

1. Enrollment ceremony (`2-of-3` setup).
2. Normal unlock ceremony (daily use).
3. Recovery ceremony (one device lost).
4. Rotation ceremony (post-recovery hardening).
5. Ceremony status visibility on all devices.

## Ceremony Status UI (All 3 Browsers)

Each browser should render a ceremony panel with:

1. `Ceremony ID`, `keyRef`, `epoch`, policy (`2-of-3`).
2. Progress counters:
   - joined devices (`x/3`)
   - share acknowledgements (`x/3`)
   - verification confirmations (`x/3`)
3. Per-device cards:
   - `deviceId`
   - role (`desktop`, `phone-a`, `phone-b`)
   - state
   - last seen timestamp
4. Final status badge:
   - `ready` when ceremony finalized
   - `waiting` while in progress
   - `error` when blocked/timed out

### Device States

Canonical per-device state enum:

- `discovered`
- `joined`
- `share_received`
- `verified`
- `ready`
- `offline`
- `timed_out`
- `error`

### Phase Labels

Global ceremony phase enum:

- `init`
- `collecting_joins`
- `distributing_shares`
- `verifying_shares`
- `ready`
- `error`

## 1) Enrollment Ceremony

### Step A: Initiate on desktop

Desktop creates a ceremony session record in a coordination DB/topic:

```json
{
  "type": "threshold.ceremony.init",
  "ceremonyId": "uuid",
  "keyRef": "db:my-list",
  "policy": { "t": 2, "n": 3 },
  "devices": ["desktop", "phone-a", "phone-b"],
  "epoch": 1
}
```

### Step B: Device joins

Each phone joins and publishes:

```json
{
  "type": "threshold.ceremony.join",
  "ceremonyId": "uuid",
  "deviceId": "phone-a",
  "pubKey": "<device-pubkey>"
}
```

### Step C: Share generation and wrapping

After all devices joined:

1. Generate threshold secret material for `keyRef` and `epoch`.
2. Produce device shares.
3. Wrap each share with recipient device public key.
4. Publish wrapped share envelopes (never raw shares).

```json
{
  "type": "threshold.share.envelope",
  "ceremonyId": "uuid",
  "to": "phone-a",
  "from": "desktop",
  "keyRef": "db:my-list",
  "epoch": 1,
  "wrappedShare": "<ciphertext>",
  "nonce": "<nonce>",
  "alg": "x25519-xsalsa20poly1305"
}
```

### Step D: Acknowledge and finalize

Each device stores its own wrapped share bundle locally and acknowledges:

```json
{
  "type": "threshold.ceremony.ack",
  "ceremonyId": "uuid",
  "deviceId": "phone-a",
  "keyRef": "db:my-list",
  "epoch": 1
}
```

Desktop finalizes:

```json
{
  "type": "threshold.ceremony.finalize",
  "ceremonyId": "uuid",
  "keyRef": "db:my-list",
  "epoch": 1,
  "status": "ready"
}
```

Registry metadata should include:

```json
{
  "encryptionEnabled": true,
  "encryptionMethod": "threshold-v1",
  "thresholdPolicy": { "t": 2, "n": 3 },
  "keyRef": "db:my-list",
  "epoch": 1
}
```

## 2) Normal Unlock Ceremony (Desktop + Phone-A)

### Step A: Desktop issues unlock challenge

```json
{
  "type": "threshold.unlock.request",
  "requestId": "uuid",
  "keyRef": "db:my-list",
  "epoch": 1,
  "ttlMs": 900000
}
```

### Step B: Phone-A approves and contributes

Phone-A verifies request context and emits signed approval/contribution:

```json
{
  "type": "threshold.unlock.approval",
  "requestId": "uuid",
  "deviceId": "phone-a",
  "approvalSig": "<sig>",
  "contribution": "<wrapped-threshold-contribution>"
}
```

### Step C: Desktop derives short-lived session

Desktop combines local + remote contribution to derive `sessionKey`.

Then it initializes threshold encryption config in app:

```js
{
  method: 'threshold-v1',
  keyRef: 'db:my-list',
  sessionKey,
  scopes: ['data', 'replication']
}
```

`sessionKey` stays in memory only and expires by TTL.

## 3) Recovery Ceremony (Desktop + Phone-B)

Use when `phone-a` is lost/unavailable.

1. Start recovery request with `phone-b`.
2. Reconstruct access via `desktop + phone-b`.
3. Immediately schedule rotation (`epoch + 1`) to revoke lost device.

Recovery request example:

```json
{
  "type": "threshold.recovery.request",
  "requestId": "uuid",
  "keyRef": "db:my-list",
  "lostDeviceId": "phone-a",
  "targetEpoch": 2
}
```

## 4) Rotation Ceremony (Post-Recovery)

Required after any suspected compromise or device loss.

1. Generate new threshold material for `epoch + 1`.
2. Re-issue wrapped shares for current 3-device set.
3. Mark previous epoch as revoked.
4. Reject unlock attempts using old epoch.

Rotation finalize:

```json
{
  "type": "threshold.rotate.finalize",
  "keyRef": "db:my-list",
  "oldEpoch": 1,
  "newEpoch": 2,
  "revokedDevices": ["phone-a"]
}
```

## Transport Notes (js-libp2p / OrbitDB)

1. Ceremony messages are coordination metadata; they can be replicated.
2. Raw shares must never be replicated.
3. Use authenticated envelopes per recipient.
4. Include monotonic counters/timestamps to prevent replay.
5. Bind all messages to `keyRef` and `epoch`.
6. Split transport concerns:
   - replicated/authoritative: OrbitDB log events
   - ephemeral/live: js-libp2p gossip or stream heartbeats (`lastSeen`, liveness)

## Recommended Event Schema for Status

Replicated event types:

- `threshold.ceremony.init`
- `threshold.ceremony.join`
- `threshold.share.envelope`
- `threshold.ceremony.ack`
- `threshold.ceremony.finalize`
- `threshold.ceremony.error`

Ephemeral live events:

- `threshold.heartbeat`
- `threshold.presence`
- `threshold.peer.offline`

Status reducer rule:

1. Rebuild canonical ceremony state from replicated events.
2. Overlay live heartbeat freshness for `offline/timed_out` markers.
3. Never derive final cryptographic validity from heartbeats alone.

## Security Notes

1. This removes static password entry but does not fully mitigate malicious browser extensions.
2. Session keys are high value; keep TTL short and clear on lock/tab close.
3. Do not allow silent downgrade from `threshold-v1` to password mode.

## Minimal Manual Dry Run

1. Open app in 3 browser contexts connected to same relay/network.
2. On desktop, create encrypted list in threshold mode.
3. Confirm phones appear in ceremony participant list.
4. Complete enrollment and verify registry metadata.
5. Reload desktop, perform unlock with phone-a approval.
6. Add/read todos successfully.
7. Simulate loss of phone-a; recover with phone-b.
8. Rotate epoch and verify old device is rejected.
9. Verify all three browsers display the same ceremony status and completion badge.
