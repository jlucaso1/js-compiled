// N-body simulation: float math over Float64Array.
const N: number = 5;
const STEPS: number = 8000000;
const DT: number = 0.01;
const SOLAR: number = 4.0 * Math.PI * Math.PI;
const DPY: number = 365.24;

const x: Float64Array = new Float64Array(N);
const y: Float64Array = new Float64Array(N);
const z: Float64Array = new Float64Array(N);
const vx: Float64Array = new Float64Array(N);
const vy: Float64Array = new Float64Array(N);
const vz: Float64Array = new Float64Array(N);
const m: Float64Array = new Float64Array(N);

const init: number[] = [
  0, 0, 0, 0, 0, 0, 1,
  4.84143144246472090, -1.16032004402742839, -0.103622044471123109,
  0.00166007664274403694 * DPY, 0.00769901118419740425 * DPY, -0.0000690460016972063023 * DPY,
  0.000954791938424326609,
  8.34336671824457987, 4.12479856412430479, -0.403523417114321381,
  -0.00276742510726862411 * DPY, 0.00499852801234917238 * DPY, 0.0000230417297573763929 * DPY,
  0.000285885980666130812,
  12.8943695621391310, -15.1111514016986312, -0.223307578892655734,
  0.00296460137564761618 * DPY, 0.00237847173959480950 * DPY, -0.0000296589568540237556 * DPY,
  0.0000436624404335156298,
  15.3796971148509165, -25.9193146099879641, 0.179258772950371181,
  0.00268067772490389322 * DPY, 0.00162824170038242295 * DPY, -0.0000951592254519715870 * DPY,
  0.0000515138902046611451,
];

for (let i: number = 0; i < N; i++) {
  const o: number = i * 7;
  x[i] = init[o]; y[i] = init[o + 1]; z[i] = init[o + 2];
  vx[i] = init[o + 3]; vy[i] = init[o + 4]; vz[i] = init[o + 5];
  m[i] = init[o + 6] * SOLAR;
}

// offset momentum
let px: number = 0, py: number = 0, pz: number = 0;
for (let i: number = 0; i < N; i++) { px += vx[i] * m[i]; py += vy[i] * m[i]; pz += vz[i] * m[i]; }
vx[0] = -px / SOLAR; vy[0] = -py / SOLAR; vz[0] = -pz / SOLAR;

function energy(): number {
  let e: number = 0;
  for (let i: number = 0; i < N; i++) {
    e += 0.5 * m[i] * (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
    for (let j: number = i + 1; j < N; j++) {
      const dx: number = x[i] - x[j];
      const dy: number = y[i] - y[j];
      const dz: number = z[i] - z[j];
      e -= (m[i] * m[j]) / Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  return e;
}

for (let s: number = 0; s < STEPS; s++) {
  for (let i: number = 0; i < N; i++) {
    for (let j: number = i + 1; j < N; j++) {
      const dx: number = x[i] - x[j];
      const dy: number = y[i] - y[j];
      const dz: number = z[i] - z[j];
      const d2: number = dx * dx + dy * dy + dz * dz;
      const mag: number = DT / (d2 * Math.sqrt(d2));
      const mj: number = m[j] * mag;
      const mi: number = m[i] * mag;
      vx[i] -= dx * mj; vy[i] -= dy * mj; vz[i] -= dz * mj;
      vx[j] += dx * mi; vy[j] += dy * mi; vz[j] += dz * mi;
    }
  }
  for (let i: number = 0; i < N; i++) {
    x[i] += DT * vx[i]; y[i] += DT * vy[i]; z[i] += DT * vz[i];
  }
}

console.log("RESULT " + energy().toFixed(9));
