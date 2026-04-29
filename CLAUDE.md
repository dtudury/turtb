# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commits

At the end of each response where code was changed, commit it. Prefer over-committing to under-committing — don't wait for a "perfect" stopping point. The end of a response is always the right moment to evaluate and commit.

## Commands

```bash
# Run all tests
node --test

# Run a single test file
node --test common/Turtle.test.js

# Run the CLI (requires .env or interactive prompts)
./bin/turtb.js --env-file .env
```

There is no build step — this is a native ESM project (`"type": "module"` in package.json). Tests use Node's built-in `node:test` runner discovered automatically from `*.test.js` files.

## Architecture

### Layer overview

```
bin/turtb.js          CLI entry point — parses options, wires up sync modules
src/                  Sync integrations (fileSync, archiveSync, s3Sync, webSync, originSync, outletSync)
lib/                  Established core library (TurtleDB, TurtleBranch, Workspace, codecs)
common/               New reimplementation of core codec + hx template engine (active development on newCodec branch)
```

### Core data model — Turtle / Addressifier

`Addressifier` (`common/Addressifier.js`) is a content-addressable, append-only byte store. Each appended `Uint8Array` "chunk" gets an address (its last byte index). A `CodeToAddressMap` prevents duplicate chunks. The store exposes `ReadableStream` / `WritableStream` for network sync.

`Turtle` (`common/Turtle.js`) extends `Addressifier` with a codec system. Every stored value is a `Uint8Array` whose last byte (the *footer*) identifies its codec type. Footers are allocated sequentially as codecs register. Multi-part values (arrays, objects, strings) reference sub-values either inline or by address, with the footer encoding which option is used for each part. Supported types: UNDEFINED, NULL, FALSE, TRUE, WORD (≤4-byte Uint8Array), UINT8ARRAY, STRING, UINT7, FLOAT64, DATE, SIGNATURE, COMMIT, DUPLE, EMPTY_ARRAY, ARRAY, EMPTY_OBJECT, OBJECT, VARIABLE.

`Duple` (`common/Duple.js`) is a balanced binary tree node (always exactly 2 children). Arrays and objects are encoded as trees of Duples.

`Signature` / `Signer` (`common/Signature.js`, `common/Signer.js`) handle secp256k1 signing of turtle contents. A `Signature` stores a start-address and 64 raw bytes; `Turtle.sign()` appends a signature chunk covering bytes since the last signature.

### Reactivity — Recaller

`Recaller` (`common/utils/Recaller.js`) is a fine-grained reactive dependency tracker. Functions registered with `recaller.watch(name, fn)` are automatically re-run when any data they accessed is mutated. Access is tracked via `reportKeyAccess(target, key, ...)` and mutations trigger re-runs via `reportKeyMutation(target, key, ...)`. Re-runs are batched via `nextTick` with loop detection (`loopLimit`). The `Turtle.byteLength` getter is wired into the recaller so watchers re-run when new data is appended.

### hx — dynamic markup template engine

`hx` (`common/hx.js`) is a tagged template literal function that parses HTML-like markup (including dynamic values interpolated as JS expressions) into a virtual DOM tree of `{ type, tag, attributes, children }` nodes. Void elements are handled. This is being actively reworked; `HxInput`, `HxElement`, `HxAttribute`, `HxTextNode` in `common/types/` are the new type classes replacing the old `dm.js`/DMAttribute/DMDescription approach.

### Sync integrations (src/)

Each sync module connects a `TurtleDB` instance to an external resource:
- **fileSync** — mirrors a TurtleDB workspace to/from the local filesystem, respecting `.gitignore`
- **archiveSync** / `ArchiveUpdater` — persists turtle chunks as numbered binary files under `.turtleDB/archive/<publicKey>/`
- **s3Sync** — replicates to S3-compatible object storage
- **originSync** / **outletSync** — WebSocket-based peer sync (client/server)
- **webSync** — Express HTTPS server serving turtleDB state to browsers

### lib/ vs common/

`lib/` contains the production codebase used by `bin/turtb.js`. `common/` is the in-progress reimplementation (`newCodec` branch). The path `lib/turtle/newNewCodec/` is a prior iteration of what is now being moved to `common/`.

### Test structure

Tests use `globalTestRunner` from `common/utils/TestRunner.js` (or `lib/utils/TestRunner.js` for lib tests). Each `.test.js` file calls `globalTestRunner.describe(urlToName(import.meta.url), suite => { ... })`. Use `suite.it.only` / `suite.it.skip` for focusing/skipping individual tests.
