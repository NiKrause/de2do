# Security Model

## Threat Model

Targeted improvements:

1. Remove static user password entry for routine operations.
2. Require multi-device authorization for session unlock.
3. Provide backup recovery path (loss of one device).

Assumed adversaries:

- Remote attacker obtaining stored OrbitDB data.
- Attacker with one compromised device share.
- Honest-but-curious backup holder.

## Known Limitation

If decryption happens inside a compromised browser context (e.g. malicious extension), runtime plaintext/session material can still be exfiltrated.

This design reduces password theft and single-factor compromise risk, but does not fully mitigate in-context runtime compromise.

## Security Requirements

1. Nonce safety:
   - unique nonce per record under a given key.
2. Key derivation:
   - derive subkeys with HKDF context per scope (`data`, `replication`).
3. Session controls:
   - short TTL
   - explicit lock/clear
   - epoch/version binding
4. Share handling:
   - never store raw threshold shares in OrbitDB
   - only store wrapped share payloads for intended backup recipient
5. Recovery and rotation:
   - on device loss, rotate epoch and regenerate share set
6. Integrity:
   - authenticated encryption only; reject unauthenticated payloads

## Operational Controls

1. Add per-device enrollment metadata.
2. Add audit trail entries for:
   - enroll
   - unlock
   - rotate
   - recovery
3. Enforce fallback policy:
   - deny transparent downgrade from threshold to password mode without explicit user action.
