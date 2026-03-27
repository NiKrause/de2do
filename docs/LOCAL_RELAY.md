# Local / pinned `orbitdb-relay-pinner`

## Default (this repo)

`package.json` depends on **`orbitdb-relay-pinner`** from the **npm registry** (semver, e.g. `^0.4.0`). Use:

```bash
npm install
npm run relay
```

Docker uses the same package — see root **`Dockerfile.relay`** and **`docker-compose.yml`**.

## Developing a fork of the relay

If you need an unpublished relay build:

1. **Sibling clone** — temporarily set in `package.json`:
   - `"orbitdb-relay-pinner": "file:../orbitdb-relay-pinner"`
   - then `npm install` / `pnpm install`.

2. **Vendor tarball** (portable, optional commit):

   ```bash
   cd /path/to/orbitdb-relay-pinner && npm run build && npm pack --pack-destination /path/to/simple-todo/vendor
   ```

   Then set `"orbitdb-relay-pinner": "file:./vendor/orbitdb-relay-pinner-<version>.tgz"` and reinstall.

3. Switch back to a published version when done (`^0.1.x`) so CI and other clones stay reproducible.

## Removed in-repo relay tree

The old **`relay/`** directory (`relay-enhanced.js`, separate `package.json`) is **gone**. E2E and `RELAY_IMPL=local` fallbacks in code only apply if you restore that layout yourself; **CI and Docker assume the npm package only.**
