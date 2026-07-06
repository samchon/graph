# `@samchon/graph` Benchmark Harness

This workspace is the staging area for graph benchmark work.

The current runner clones representative TypeScript repositories, builds graph dumps, records timing and graph-size metrics, and writes JSON results that can later be joined with agent prompt runs.

```bash
pnpm --filter @samchon/graph-benchmark list
pnpm --filter @samchon/graph-benchmark start -- --fixture typeorm --mode static
```
