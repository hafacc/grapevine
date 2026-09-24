#!/usr/bin/env bash
# Builds the Rust core to WebAssembly, for one of the two runtimes that load it.
#
#   nodejs  -> rust/core-wasm/                     (rust/examples/smoke.mjs)
#   web     -> supabase/functions/*/core-wasm/     (Deno, the two Edge Functions)
#
# `--target nodejs` emits CommonJS glue that `require`s `fs` to read the `.wasm`
# beside it, which Deno cannot use; `--target web` emits an `init(bytes)` an Edge
# Function calls with `Deno.readFile`. `--target deno` would write that glue
# for us and is not used: it fetches its own module URL, and a function that
# reads the file itself has one fewer way to fail in a sandbox.
#
# Each Edge Function gets its own copy rather than importing a neighbour's:
# `supabase functions deploy` uploads one function's directory, and the `.wasm`
# is not an import at all — it is read by path, and `config.toml`'s
# `static_files` names it per function.
#
# Neither output is committed, so this has to have run before anything reads an
# import of it; CI runs both targets in the rust job.
#
# `--out-dir` precedes `--features` because wasm-pack forwards everything after
# the first unrecognized flag to cargo.
set -euo pipefail

target="${1:-}"
case "$target" in
  nodejs) out=core-wasm ;;
  web)    out=../supabase/functions/refresh-recs/core-wasm ;;
  *)      echo "usage: build-wasm.sh <nodejs|web>" >&2; exit 2 ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wasm-pack build "$here/rust" \
  --target "$target" \
  --out-dir "$out" \
  --features wasm

if [ "$target" = web ]; then
  rm -rf "$here/supabase/functions/refresh-suggestions/core-wasm"
  cp -R "$here/supabase/functions/refresh-recs/core-wasm" \
        "$here/supabase/functions/refresh-suggestions/core-wasm"
fi
