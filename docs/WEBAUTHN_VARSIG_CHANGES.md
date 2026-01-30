# WebAuthn Varsig Integration Changes

Date: 2026-01-29
Branch: varsic

This document summarizes the changes made to align Simple Todo with the WebAuthn varsig OrbitDB example, and to tighten identity handling.

## Goals
- Prefer WebAuthn varsig identities (hardware-backed signing per write).
- Cache varsig identity to avoid re-signing on every app start.
- Provide identity storage for OrbitDB identities (Helia blockstore).
- Add identity management methods (addIdentity) to the identities object.
- Keep varsig strict: fail initialization if OrbitDB does not use the varsig identity.
- Add explicit UI choice for WebAuthn vs password for encryption.
- Use WebAuthn PRF-derived key for SimpleEncryption when available; fall back to password.

## Key Changes

### Varsig identity caching
- Added `src/lib/identity/varsig-identity.js`.
- Cache key now matches the example:
  - `webauthn-varsig-orbitdb-identity`
- Cached identity is verified before reuse.

### OrbitDB identity wiring
- `src/lib/p2p.js` now:
  - uses cached varsig identity
  - supplies an identity storage adapter to `createWebAuthnVarsigIdentitiesWithStorage`
  - supports `addIdentity`
  - asserts that OrbitDB identity matches the varsig identity, and throws on mismatch

### Identity storage adapter
- Implemented `createIpfsIdentityStorage` (Helia blockstore-backed), mirroring the example.

### Encryption flow updates
- Replication encryption removed; only data encryption is used.
- Added WebAuthn PRF-derived secret key support for SimpleEncryption.
- Added UI toggle to explicitly choose WebAuthn vs password.
- Registry now stores encryption method (`webauthn-prf` or `password`).

## Notable Behavior
- Varsig signs per write, so multiple passkey prompts on startup are expected (identity creation, registry updates, default list creation).
- If OrbitDB identity is not varsig, initialization now fails with a clear error.

## Files Touched (main)
- `src/lib/identity/varsig-identity.js`
- `src/lib/identity/webauthn-identity.js`
- `src/lib/p2p.js`
- `src/lib/encryption/webauthn-encryption.js`
- `src/lib/components/encryption/EncryptionSettings.svelte`
- `src/lib/handlers/encryption-handlers.js`
- `src/lib/database/database-manager.js`
- `src/lib/encryption-migration.js`
- `src/lib/encryption/encryption-detector.js`
- `src/lib/todo-list-manager.js`

## Next Checks
- Verify varsig identity remains active after init:
  - `orbitdb.identity.type === 'webauthn-varsig'`
  - `orbitdb.identity.id` matches `did:key:...`
- Validate passkey prompts occur on DB writes (expected for varsig).


## Varsig PRF Bridge (SimpleEncryption)

We now reuse the **varsig passkey credential** to unlock a PRF-derived secret key for SimpleEncryption. This avoids creating a second WebAuthn credential for the keystore flow when varsig is active.

### What the bridge does
- Uses the **varsig credentialId** to call WebAuthn `navigator.credentials.get()` with the **PRF extension**.
- Derives an AES key from PRF output and uses it to **wrap/unwrap** a randomly generated secret key (sk).
- Stores the wrapped key (ciphertext + iv + salt) in localStorage, keyed by credentialId.

### Why it is "custom"
The upstream varsig credential creation does not request PRF during registration, and the keystore flow uses a different credential format. The bridge stitches these pieces together by:
- using varsig credentialId for PRF assertions
- using the existing PRF wrap/unwrap helpers
- keeping SimpleEncryption independent of keystore identities

If PRF is unavailable for the varsig credential, the app falls back to password encryption.

## Sequence Diagrams

### Varsig identity creation (fresh browser)

```mermaid
sequenceDiagram
  autonumber
  participant User
  participant App
  participant WebAuthn
  participant Auth as Authenticator
  participant Storage as localStorage
  participant OrbitDB

  User->>App: Start app, accept consent
  App->>WebAuthn: createCredential (varsig + PRF)
  WebAuthn->>Auth: Register passkey
  Auth-->>WebAuthn: Attestation
  WebAuthn-->>App: Credential (credentialId, publicKey, did)
  App->>Storage: storeWebAuthnVarsigCredential
  App->>WebAuthn: get() for id varsig (orbitdb-id:)
  WebAuthn->>Auth: User verification
  Auth-->>WebAuthn: Assertion
  WebAuthn-->>App: Varsig for id
  App->>WebAuthn: get() for pubkey varsig (orbitdb-pubkey:)
  WebAuthn->>Auth: User verification
  Auth-->>WebAuthn: Assertion
  WebAuthn-->>App: Varsig for pubkey
  App->>Storage: store varsig identity cache
  App->>OrbitDB: createOrbitDB(identity=varsig)
```

### Varsig identity reuse (subsequent runs)

```mermaid
sequenceDiagram
  autonumber
  participant App
  participant Storage as localStorage
  participant WebAuthn
  participant OrbitDB

  App->>Storage: load varsig identity cache
  App->>Storage: load varsig credential
  App->>WebAuthn: verify cached identity (varsig verify)
  App-->>App: identity valid
  App->>OrbitDB: createOrbitDB(identity=varsig)
```

### SimpleEncryption PRF (varsig credential bridge)

```mermaid
sequenceDiagram
  autonumber
  participant User
  participant App
  participant WebAuthn
  participant Auth as Authenticator
  participant Storage as localStorage

  App->>Storage: load varsig credential (credentialId)
  alt wrapped SK exists
    App->>WebAuthn: get() with PRF (unwrap)
    WebAuthn->>Auth: User verification
    Auth-->>WebAuthn: PRF output
    WebAuthn-->>App: PRF output
    App-->>App: unwrap SK
  else no wrapped SK
    App->>WebAuthn: get() with PRF (wrap)
    WebAuthn->>Auth: User verification
    Auth-->>WebAuthn: PRF output
    WebAuthn-->>App: PRF output
    App-->>App: wrap new SK
    App->>Storage: store wrapped SK + salt
  end

  Note over App,Storage: Wrapped SK cached under key: simple-encryption-sk-v1:{credentialId}
```

### Where credentials are stored

```mermaid
flowchart TD
  VarsigCred[Varsig credential]
  VarsigId[Varsig identity cache]
  PrfKey[Wrapped SK for SimpleEncryption]

  VarsigCred -->|localStorage key| A[webauthn-varsig-credential]
  VarsigId -->|localStorage key| B[webauthn-varsig-orbitdb-identity]
  PrfKey -->|localStorage key| C[simple-encryption-sk-v1:credentialId]
```
