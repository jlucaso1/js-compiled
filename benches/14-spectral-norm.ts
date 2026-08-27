// Float math with dense array access.
const N: number = 3000;

function A(i: number, j: number): number {
  return 1.0 / ((i + j) * (i + j + 1) / 2 + i + 1);
}

function mulAv(v: Float64Array, out: Float64Array): void {
  for (let i: number = 0; i < N; i++) {
    let s: number = 0;
    for (let j: number = 0; j < N; j++) s += A(i, j) * v[j];
    out[i] = s;
  }
}

function mulAtv(v: Float64Array, out: Float64Array): void {
  for (let i: number = 0; i < N; i++) {
    let s: number = 0;
    for (let j: number = 0; j < N; j++) s += A(j, i) * v[j];
    out[i] = s;
  }
}

const u: Float64Array = new Float64Array(N);
const v: Float64Array = new Float64Array(N);
const t: Float64Array = new Float64Array(N);
for (let i: number = 0; i < N; i++) u[i] = 1.0;

for (let it: number = 0; it < 20; it++) {
  mulAv(u, t); mulAtv(t, v);
  mulAv(v, t); mulAtv(t, u);
}

let vBv: number = 0, vv: number = 0;
for (let i: number = 0; i < N; i++) { vBv += u[i] * v[i]; vv += v[i] * v[i]; }
console.log("RESULT " + Math.sqrt(vBv / vv).toFixed(9));
