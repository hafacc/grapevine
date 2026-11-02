// The Rust core, built by `scripts/build-wasm.sh web` into `web/core-wasm/`,
// which is not committed. Declared here so `lint` and `test` need no build:
// `vite.config.ts` points both names at the build output.

declare module "grapevine-core" {
  /** Instantiates the module from the address of its `.wasm`. */
  export default function init(input: {
    module_or_path: string;
  }): Promise<unknown>;

  /**
   * One viewer's scores and plot from a snapshot, at a rank from 1 to 6;
   * `rust/src/wasm.rs` is the contract.
   */
  export function computeUserTensor(
    snapshot: unknown,
    viewer: string,
    rank?: number,
  ): unknown;

  /** A place in the plane for each named point of a plot. */
  export function layOut(points: unknown): unknown;
}

declare module "grapevine-core/wasm?url" {
  const url: string;
  export default url;
}
