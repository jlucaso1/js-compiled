// 1024x1024 matrix multiply, cache bound.
const N: number = 1024;

function makeMatrix(seedIn: number): Float64Array {
  const m: Float64Array = new Float64Array(N * N);
  let seed: number = seedIn;
  for (let i: number = 0; i < N * N; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    m[i] = (seed % 1000) / 1000.0;
  }
  return m;
}

const a: Float64Array = makeMatrix(1);
const b: Float64Array = makeMatrix(2);
const c: Float64Array = new Float64Array(N * N);

for (let i: number = 0; i < N; i++) {
  for (let k: number = 0; k < N; k++) {
    const aik: number = a[i * N + k];
    if (aik === 0) continue;
    const kOff: number = k * N;
    const iOff: number = i * N;
    for (let j: number = 0; j < N; j++) {
      c[iOff + j] += aik * b[kOff + j];
    }
  }
}

let sum: number = 0;
for (let i: number = 0; i < N * N; i++) sum += c[i];
console.log("RESULT " + sum.toFixed(6));
