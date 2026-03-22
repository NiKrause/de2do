# Alto bundler config (`alto-config.json`)

The `entrypoints` field is a **comma-separated list** of EntryPoint contract addresses Alto will accept.

For **simple-todo** passkey / EIP-7702 flows, the app and Foundry scripts use **EntryPoint v0.8** only:

`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`

Older entrypoints may remain in the list for compatibility with Pimlico’s `mock-contract-deployer` or other tooling; **`VITE_ENTRY_POINT_ADDRESS` must still be v0.8** (see `docs/HOWTO_PASSKEY_ESCROW.md`).

After changing `alto-config.json`, restart the `alto` container:

`docker compose -f docker-compose.aa-local.yml up -d --force-recreate alto`
