Title: Add “P2P Passkeys” to Storacha OrbitDB Backup/Restore Widget (new shared repo)

Summary
Add a new “P2P Passkeys” feature to the Storacha backup/restore widget that enables passkey-based DID identities to sync and recover across devices via an OrbitDB registry database. This work should be implemented in a NEW, shared repository that can be reused by simple-todo and other OrbitDB projects, and then consumed by simple-todo.

Background / References
- WebAuthn DID provider: orbitdb-identity-provider-webauthn-did (branch pr-15)
- UCAN signing, verification, delegation flows: /Users/nandi/ucan-upload-wall (worker ed25519 + varsig ed25519 and p-256)
- Storacha OrbitDB bridge: https://github.com/NiKrause/orbitdb-storacha-bridge/
- This repo already has libp2p + Helia/IPFS configuration and OrbitDB integration
- Current widget uses Storacha backup/restore for OrbitDB data

Goals
1. Add a “P2P Passkeys” section to the widget that enables creating and syncing passkey-based DID identities.
2. Use WebAuthn in worker mode for the first step (this is the only required flow for initial release).
3. Store WebAuthn credential data in the OrbitDB registry DB, not in localStorage.
4. Allow device-to-device sync by copying a peerId or multiaddress JSON and pasting it into another browser/device.
5. Ensure passkey recovery flow supports re-linking using an existing passkey (YubiKey/Apple/Chrome passkey) to resync registry DB data before DID re-creation.
6. Default the Storacha access flow to UCAN proof input only, using worker-mode WebAuthn ed25519 DID keys for UCAN signing and verification.
7. Store UCAN delegations (proofs) in the registry DB and ensure they can be restored and reused.
8. Implement this as a new shared repo/module that can be used by simple-todo and other OrbitDB projects.

Non-Goals (for first iteration)
- Varsig WebAuthn paths (Ed25519, P-545) — planned for a follow-up milestone
- Any ngrok bootstrap or external bootstrap config
- UI redesign of the entire widget

Requirements
- Use the WebAuthn DID provider with worker mode only for v1.
- Reuse this repo’s existing libp2p + Helia/IPFS configuration.
- No passkey credential data in localStorage.
- Persist and replicate passkey credential data via an OrbitDB registry DB (as in pr-15).
- Default the widget to accept only UCAN proofs for Storacha access, signed and verified with worker-mode WebAuthn ed25519 DID keys.
- Store UCAN delegations in the registry DB and keep them in sync across devices.
- Backup and restore the OrbitDB databases used by pr-15, including registry, recovery, and access-control DBs, into the Storacha space referenced by the UCAN delegation.
- Store a manifest JSON in Storacha that contains all related OrbitDB addresses; the manifest CID must be tracked by an IPNS key derived from a WebAuthn-PRF key.
- Use WebAuthn discoverable credentials + PRF to recover the IPNS key seed and load the manifest CID, even when the public key is not locally available.
- Use Storacha IPNS infrastructure to ensure the IPNS key/value record is persisted and does not vanish.
- Allow device linking by copying peerId or multiaddress JSON to clipboard and pasting into another browser/device.
- Support UCAN delegation creation and import/export as in ucan-upload-wall.
- Default UCAN exchange should be over libp2p, while still supporting copy/paste and IPFS CAR/CID import/export.
- Keep the widget UI minimal; show advanced flows in modals only.

Suggested UX
- A compact “P2P Passkeys” card in the widget with a single primary action.
- Tiny icon button to copy peerId or multiaddress JSON to clipboard.
- Tiny icon button or input to paste a peer ID/multiaddr to link another device.
- A minimal status line: Connected / Syncing / Error.
- Modal-only flows for UCAN creation, delegation import/export, and advanced recovery steps.

Implementation Notes
- Import and configure the WebAuthn DID provider from the branch logic in pr-15.
- Replace ngrok bootstrap with this repo’s existing libp2p bootstrap/relay config.
- Use worker-mode WebAuthn ed25519 DID keys for UCAN signing, verification, and delegation handling.
- Store WebAuthn credential metadata and UCAN proofs in the registry OrbitDB.
- Implement manifest JSON creation and store it in Storacha; update IPNS to point to the latest manifest CID.
- Recover IPNS seed using WebAuthn+PRF and restore registry DBs before DID re-creation.
- Package this as a new shared repo/module and consume it from simple-todo.

Milestones
1. v1 (Worker mode only): P2P passkeys, UCAN proof-only flow, registry DB storage, copy/paste link flow, and recovery via WebAuthn+PRF.
2. v2 (Varsig): Add WebAuthn varsig Ed25519 and P-545 paths; expose selection only in modal UI.
3. v3 (UCAN UX): Add libp2p UCAN exchange plus copy/paste and CAR/CID import/export in modal UI.

Acceptance Criteria
- Passkey credential data never lands in localStorage.
- Widget accepts only UCAN proofs by default for Storacha access.
- UCAN proofs are stored in the registry DB and restored after recovery.
- Two browsers/devices can connect using copied peerId/multiaddr and sync registry DB.
- A browser with wiped local data can re-link using an existing passkey, recover IPNS state, load the manifest CID, and reconstruct the DID after registry sync.
- Storacha IPNS is used and the IPNS record persists.
- No ngrok bootstrap config is used.
- Uses existing libp2p + Helia/IPFS config in this project.
- The feature lives in a new shared repo/module used by simple-todo and other OrbitDB projects.
