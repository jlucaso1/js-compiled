# js-compiled

Benchmarks JavaScript/TypeScript runtimes that execute directly against compilers
that produce a native binary, on five axes: **execution time**, **peak memory**,
**binary size**, **compile time**, and **coverage** — how much real JS/TS each
compiler actually accepts.

Results are produced entirely by GitHub Actions and published to GitHub Pages.

## Candidates

| runner | kind | what it is |
|---|---|---|
| `node` | executes directly | Node.js (V8, JIT), runs `.ts` via type stripping |
| `bun` | executes directly | Bun (JavaScriptCore, JIT) |
| `scriptc` | **compiles** | [vercel-labs/scriptc](https://github.com/vercel-labs/scriptc) — TS → IR → LLVM → native, no JS engine |
| `porffor` | **compiles** | [CanadaHonk/porffor](https://github.com/CanadaHonk/porffor) — AOT JS/TS → C → native |
| `perry` | **compiles** | [PerryTS/perry](https://github.com/PerryTS/perry) — TypeScript → native, pinned to 0.5.1520 |

Extras, enabled with `--runners=all`:

| runner | what it is |
|---|---|
| `scriptc-dynamic` | scriptc with `--dynamic`, embedding quickjs-ng for what will not compile statically |
| `porffor-js` | Porffor fed the same program with type annotations stripped |
| `shermes` | [facebook/hermes](https://github.com/facebook/hermes) (`static_h` branch) — AOT JS/TS → Hermes IR → C → native |
| `quickjs-ng` | [quickjs-ng/quickjs](https://github.com/quickjs-ng/quickjs) — compiles JS to standalone executable bundling bytecode and engine |
| `bun-compile` | `bun build --compile` — bundles the code **with the engine** |
| `deno-compile` | `deno compile` — same idea |
| `deno` | Deno executing directly |

`bun-compile` and `deno-compile` produce "a binary", but they are not AOT
compilers: they embed the whole runtime. They are here to anchor the binary-size
column against the real AOT output.

Porffor, Static Hermes, and QuickJS-ng are vendored from git at their latest commits / pinned releases (Porffor
on `main`, Hermes on `static_h`, QuickJS-ng on `v0.16.2`); their exact commits are recorded in every result
file. Perry is pinned to 0.5.1520 for reproducibility.

## Usage

```sh
npm ci
./scripts/setup.sh                 # vendors Porffor and builds Static Hermes and QuickJS-ng

node harness/run.mjs --list        # benches and runners
node harness/run.mjs               # the five main candidates, 5 runs each
node harness/run.mjs --runners=all
node harness/run.mjs --benches=10-fib --runs=10
node harness/run.mjs --quick       # 1 run, no warmup
node harness/run.mjs --runners=node,perry --quick  # test the pinned Perry release

node harness/report.mjs            # results/latest.json -> REPORT.md + site/index.html
```

Requires Node 24+, `clang` (scriptc, Static Hermes), `cc` (Porffor, QuickJS-ng), `cmake`, `ninja`, ICU development headers and Python 3 (Static Hermes), and GNU `time` on Linux (peak RSS). The Node/Perry comparison also runs on macOS using BSD `time -l` and a `ps` process-tree watchdog. Run `npm test` to check watchdog behavior.

Perry uses the exact release in `package-lock.json`. For a local compiler or an older installation, set `PERRY_BIN` to its absolute executable path; the harness records its reported version. For example:

```bash
PERRY_BIN=/absolute/path/to/perry node harness/run.mjs --runners=node,perry --quick
```

## Benchmarks

`benches/` holds 22 programs in erasable TypeScript — annotations only, no `enum`,
`namespace` or parameter properties — deterministic (seeded PRNG, no `Date` or
`Math.random`), each ending in a `RESULT <value>` line the harness compares
against Node's output to verify correctness.

| # | bench | what it stresses |
|---|---|---|
| 00 | `noop` | runtime startup only |
| 01 | `hello` | startup plus string interpolation |
| 10 | `fib` | recursion, function call cost |
| 11 | `loop-sum` | tight arithmetic loop |
| 12 | `mandelbrot` | dense floating point, no allocation |
| 13 | `nbody` | float math over `Float64Array` |
| 14 | `spectral-norm` | float math, dense array access |
| 15 | `crc32` | integer bitwise ops, 8 MB `Uint8Array` |
| 20 | `sieve` | linear memory, 100 MB `Uint8Array` |
| 21 | `matmul` | 1024³, cache bound |
| 22 | `array-sort` | `sort` with a comparator, 6M elements |
| 23 | `binary-trees` | heavy object allocation, GC pressure |
| 24 | `map-set` | `Map`/`Set` with string and numeric keys |
| 30 | `string-build` | concat, `join`, `split`, `toUpperCase` |
| 31 | `json` | `JSON.parse` and `JSON.stringify` round trips |
| 32 | `regex` | regex engine with capture groups |
| 40 | `classes` | inheritance, virtual dispatch |
| 41 | `closures` | higher-order functions, `map`/`filter`/`reduce` |
| 42 | `async` | `async`/`await`, `Promise.all`, microtasks |
| 43 | `generators` | generators, `for..of`, iterator chaining |
| 50 | `fs-io` | `node:fs` |
| 51 | `pipeline` | application shaped: objects, `Map`, aggregation, sort |

Workloads are sized to roughly 0.3–1.7 s under Node — high enough that startup
does not dominate, low enough for a JIT-less AOT binary to finish.

## Methodology

- **Time** is `hrtime` around `spawn`, with no wrapper: GNU `time` resolves to
  10 ms, useless for a binary that runs in 1 ms. The harness measures and reports
  its own spawn overhead (`/bin/true`) so it can be discounted on startup benches.
- **Memory** is peak RSS from separate runs under `/usr/bin/time -f %M` on Linux
  or `/usr/bin/time -l` on macOS, normalized to KiB in result JSON. The watchdog
  separately monitors the sum of RSS across the workload's process tree.
- **Correctness** compares each runner's `RESULT` line against Node's. A fast
  runner that answers wrong is reported as a mismatch, not as a win.
- **Warmup** warms the page cache, not the JIT — every run is a fresh process, so
  V8/JSC pay their warmup on each one. That is deliberate: it is exactly the gap
  an AOT binary exploits on short-lived workloads and CLIs.
- **CI sharding**: one job per bench, so all runners in a row are measured on the
  same machine under the same load. Across benches the hardware may differ, so
  compare runners within a row, not numbers between rows.
- **Anti-folding**: `fib`, `crc32`, `string-build`, `classes` and `closures` vary
  their input per iteration. Without that, an AOT compiler folds a pure repeated
  computation into a single call while V8 executes all of them, and the benchmark
  measures optimizer luck instead of the workload.
- Every bench is single-threaded. No per-runner tuning: everything runs on defaults.

### Not measured

HTTP throughput, startup under I/O load, container image size, energy use.

### Known toolchain issues

- `scriptc --dynamic` still rejects `SC2011` (`any`-typed operator) even though
  `scriptc coverage --dynamic` reports the site as compilable — so `31-json` fails
  to build in both scriptc modes.
- A runner that exhausts memory used to take the whole CI agent down with it, so
  every run is capped by an RSS watchdog (`--mem-limit-mb`, 4096 by default) and
  reported as `out-of-memory`. The harness also raises its own `oom_score_adj`
  (children inherit it) and writes the result file after every pair, so a killed
  job still leaves a usable shard. Timeout and memory limits kill the entire
  process group, including children of compiler and memory-measurement wrappers.
  Limits apply to builds, correctness checks, warmups, timing, and RSS runs;
  failures retain their phase and reason in the result JSON.

## Layout

```
benches/              benchmark programs
harness/runners.mjs   how each runner compiles and executes
harness/exec.mjs      timing and RSS measurement
harness/run.mjs       orchestration, writes the result JSON
harness/merge.mjs     merges CI shards into one result file
harness/report.mjs    result JSON -> REPORT.md + site/index.html
scripts/setup.sh      vendors Porffor at the latest commit
```

## License

MIT
