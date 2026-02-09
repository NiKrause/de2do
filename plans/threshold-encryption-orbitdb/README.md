# OrbitDB Threshold Encryption Plan

This directory contains the implementation plan for a new encryption package that follows the `SimpleEncryption` interface pattern while adding threshold-based key control.

## Goal

Build a package and integration path for OrbitDB that:

1. Supports OrbitDB encryption hooks:
   - `encryption.data` (payload encryption)
   - `encryption.replication` (oplog entry encryption)
2. Exposes a `SimpleEncryption`-compatible API:
   - `encrypt(Uint8Array) -> Promise<Uint8Array>`
   - `decrypt(Uint8Array) -> Promise<Uint8Array>`
3. Replaces password-centric key handling with threshold-controlled session unlock:
   - baseline target: `2-of-3` (`desktop`, `phone-a`, `phone-b`)
4. Includes a secure demo/prototype flow for DKG-style coordination over OrbitDB without claiming production-grade audited cryptography.

## Documents

- `IMPLEMENTATION_PLAN.md`: phased implementation roadmap
- `API_SPEC.md`: package-level API and wire format
- `SECURITY_MODEL.md`: threat model, constraints, and safeguards
- `WORK_ITEMS.md`: concrete task breakdown and acceptance criteria

## Non-Goals (initial phase)

- Full production-ready threshold signing protocol implementation
- Formal cryptographic proofs
- Hardware token integration (YubiKey/Ledger) in first milestone
