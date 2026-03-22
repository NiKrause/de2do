# Local `orbitdb-relay-pinner`

`package.json` may point `orbitdb-relay-pinner` at a **local directory** (e.g. `file:../../../../orbitdb-relay-pinner`) so you can run `pnpm relay` against an unpublished relay build.

- Adjust the relative path if your relay clone lives elsewhere (e.g. `~/orbitdb-relay-pinner` vs this repo under `Documents/projekte/...`).
- After publishing **orbitdb-relay-pinner** to npm, switch to a semver range (e.g. `^0.1.27`) and run `pnpm install`.

## Tarball in `vendor/`

To avoid a sibling path, pack into this repo:

```bash
cd /path/to/orbitdb-relay-pinner && npm run build && npm pack --pack-destination /path/to/simple-todo/vendor
```

Then set `"orbitdb-relay-pinner": "file:./vendor/orbitdb-relay-pinner-0.1.27.tgz"` in `package.json` and run `pnpm install`.

A generated `vendor/orbitdb-relay-pinner-0.1.27.tgz` is optional to commit (portable for CI until the version is on npm).
