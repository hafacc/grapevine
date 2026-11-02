#!/usr/bin/env bash
# Builds the Rust core to WebAssembly, for one of the two runtimes that load it.
#
#   nodejs  -> rust/core-wasm/              (rust/examples/smoke.mjs)
#   web     -> web/core-wasm/               (the browser, in a worker)
#
# `--target nodejs` emits CommonJS glue that `require`s `fs` to read the `.wasm`
# beside it, which a browser cannot use; `--target web` emits an `init(url)` the
# worker calls with the address Vite gave the `.wasm`.
#
# Neither output is committed, so this has to have run before `bun export`
# or `bun dev`; `bun lint` and `bun run test` need neither, because the
# worker's import is typed by `web/src/core-wasm.d.ts`.
#
# `--out-dir` precedes `--features` because wasm-pack forwards everything after
# the first unrecognized flag to cargo.
set -euo pipefail

target="${1:-}"
case "$target" in
  nodejs) out=core-wasm ;;
  web)    out=../web/core-wasm ;;
  *)      echo "usage: build-wasm.sh <nodejs|web>" >&2; exit 2 ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# From the crate's own directory: rustup picks the toolchain by where it is
# run, and from anywhere else the pin in `rust/rust-toolchain.toml` is not read.
cd "$here/rust"
wasm-pack build . \
  --target "$target" \
  --out-dir "$out" \
  --features wasm
