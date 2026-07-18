import Module from "node:module";

// The coverage harness (`c8`) exports a `NODE_PATH` that points into the pnpm
// virtual store (`node_modules/.pnpm/node_modules`) so the instrumented child
// process can load c8's own modules. A side effect is that
// `createRequire(...).resolve("ttsc/package.json")` then succeeds from ANY
// directory — even a throwaway fixture root outside every project — because the
// workspace's real `ttsc` is reachable through that store. Product code never
// runs under such a `NODE_PATH`, so a resolver fixture that means to observe the
// intended "walk up from this project root" lookup must strip it first; without
// this the same test resolves nothing under a plain run yet resolves the real
// binary under coverage, diverging local runs from CI.
//
// Node captures `NODE_PATH` into `Module.globalPaths` once at startup, so simply
// deleting the variable is not enough — the derived search paths must be rebuilt
// for the change to take effect. `Module._initPaths()` re-derives them from the
// current environment; the original state is restored in `finally`.
const initPaths = (Module as unknown as { _initPaths: () => void })._initPaths.bind(Module);

/**
 * Run `task` with Node's `NODE_PATH`-derived global module search paths removed,
 * so a `require.resolve` inside it behaves as it would in production rather than
 * under the coverage harness. Restores the previous state unconditionally.
 */
const withoutGlobalNodePath = async <T>(task: () => T | Promise<T>): Promise<T> => {
  const saved = process.env.NODE_PATH;
  delete process.env.NODE_PATH;
  initPaths();
  try {
    return await task();
  } finally {
    if (saved === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = saved;
    initPaths();
  }
};

export const NodeResolution = {
  withoutGlobalNodePath,
};
