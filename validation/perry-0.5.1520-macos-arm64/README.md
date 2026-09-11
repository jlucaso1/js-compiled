# Perry 0.5.1520 local validation

Measured 2026-09-11 on macOS ARM64: Apple M1 Max, 10 cores, 64 GiB RAM,
Node v26.5.1. The benchmark source is unchanged from upstream commit
`ca813a911477b5687694c5a74a5132421f982d1c`. No compiler or runtime tuning was used.

Perry **0.5.1520 passes all 22 benchmarks**, with matching Node results and no
build failures, crashes, timeouts, or memory-limit failures. The previous npm
release, **0.5.1220**, reproduces the binary-tree memory failure on the same host.
The new Perry release already resolves that reproduced failure; this PR restores
the runner and fixes the benchmark harness, without modifying Perry itself.

## Memory reproduction

The earlier [removal commit](https://github.com/jlucaso1/js-compiled/commit/8c131e2bc501dc740939671bb415a22e8ec95a66)
removed the README's observation of about 6.2 GB and a CI-agent failure. That
historical Linux measurement is separate from this local comparison.

| Workload / runtime | Outcome | RSS (MiB) | Median time (s) |
|---|---|---:|---:|
| Binary trees / Perry 0.5.1220 | Killed after 7.78 s, above the 4096 MiB limit | 4293.2 sampled at kill | — |
| Binary trees / Perry 0.5.1520 | Correct: `136664414` | 203.2 | 2.726 |
| Binary trees / Node | Correct: `136664414` | 271.2 | 1.347 |
| JSON / Perry 0.5.1520 | Correct | 952.9 | 3.178 |
| JSON / Node | Correct | 238.3 | 0.994 |

The old process was killed before completion; 4293.2 MiB is not its peak for a
completed workload. The new-release rows use five timed runs, one warmup, two
RSS runs, and an initial correctness check. Every execution returned the same
result. RSS stayed around 203 MiB for binary trees and 953 MiB for JSON.

## Full quick sweep

One correctness run, one timed run and one separate RSS run per pair. All 22
Perry results match Node. Times below are milliseconds; memory is MiB. These
are local diagnostic measurements on a shared developer machine, not published
Linux CI results. macOS monitoring uses a `ps` watchdog.

| Workload | Node ms | Perry ms | Node MiB | Perry MiB |
|---|---:|---:|---:|---:|
| `00-noop.ts` | 103.8 | 5.3 | 76.7 | 5.2 |
| `01-hello.ts` | 97.1 | 4.7 | 77.3 | 5.3 |
| `10-fib.ts` | 1143.9 | 434.8 | 81.3 | 5.4 |
| `11-loop-sum.ts` | 2825.0 | 1095.0 | 82.8 | 5.2 |
| `12-mandelbrot.ts` | 1460.0 | 1339.3 | 83.4 | 5.2 |
| `13-nbody.ts` | 838.6 | 12648.8 | 84.0 | 5.9 |
| `14-spectral-norm.ts` | 1658.2 | 1642.8 | 84.2 | 5.8 |
| `15-crc32.ts` | 1392.3 | 5175.0 | 92.2 | 14.7 |
| `20-sieve.ts` | 936.1 | 838.7 | 177.6 | 112.6 |
| `21-matmul.ts` | 1441.0 | 34984.6 | 108.6 | 31.6 |
| `22-array-sort.ts` | 1626.6 | 5077.9 | 271.6 | 257.2 |
| `23-binary-trees.ts` | 1249.2 | 2449.4 | 271.0 | 203.2 |
| `24-map-set.ts` | 1193.3 | 742.7 | 153.4 | 22.6 |
| `30-string-build.ts` | 736.0 | 976.3 | 330.4 | 633.9 |
| `31-json.ts` | 935.9 | 3162.6 | 237.3 | 952.9 |
| `32-regex.ts` | 1081.4 | 9732.3 | 132.6 | 62.9 |
| `40-classes.ts` | 464.2 | 3206.1 | 144.1 | 52.2 |
| `41-closures.ts` | 1386.9 | 9466.7 | 125.1 | 43.3 |
| `42-async.ts` | 438.3 | 2773.1 | 230.1 | 328.6 |
| `43-generators.ts` | 1403.1 | 24553.7 | 84.8 | 37.5 |
| `50-fs-io.ts` | 446.1 | 539.7 | 249.9 | 83.0 |
| `51-pipeline.ts` | 876.7 | 1554.9 | 428.9 | 283.3 |

Performance still needs work: Perry was about 15.1x slower on nbody, 24.3x on
matmul, and 17.5x on generators in this quick sweep. JSON also used more memory
than Node, although it completed below the existing 4096 MiB cap. Passing this
suite does not establish equal performance or universal memory correctness.

## Reproduce

```sh
npm ci
npm test
node harness/run.mjs --runners=node,perry --quick --timeout=120 --out=results/perry-full.json
node harness/run.mjs --runners=node,perry --benches=23-binary-trees,31-json --runs=5 --warmup=1 --rss-runs=2 --timeout=120 --out=results/perry-repeated.json
PERRY_BIN=/absolute/path/to/perry-0.5.1220 node harness/run.mjs --runners=node,perry --benches=23-binary-trees --quick --timeout=30 --out=results/perry-old.json
```

The final command requires a separate installation of Perry 0.5.1220. All runs
use the default 4096 MiB memory limit. The npm dependency pins the new compiler
to the actual [0.5.1520 release](https://github.com/PerryTS/perry/releases/tag/v0.5.1520).

Local checks: 12 harness regression tests pass, covering child-process
termination, RSS units, failure propagation, compiler failure after writing an
output file, Node oracle selection, and excluding incorrect results from timing
rankings. Linux execution was not performed locally; the added workflow tests
the harness on macOS/Linux and runs the real binary-tree/JSON workloads on Linux.

## Raw evidence

- [Full 22-workload sweep](full.json)
- [Old-release binary-tree failure](old-binary-trees.json)
- [Repeated new-release binary-tree/JSON runs](repeated.json)

The first sweep predates the added `referenceVersion` and `checkMs` metadata
fields; its Node-first oracle, compiler options, memory monitoring, and workload
sources are the same. All times and outputs above come from these raw files.
