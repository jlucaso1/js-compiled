// Dense floating point, no allocation.
const W: number = 2200;
const H: number = 2200;
const MAX: number = 300;

let inside: number = 0;
for (let py: number = 0; py < H; py++) {
  const cy: number = (py / H) * 2.0 - 1.0;
  for (let px: number = 0; px < W; px++) {
    const cx: number = (px / W) * 3.0 - 2.0;
    let x: number = 0.0;
    let y: number = 0.0;
    let it: number = 0;
    while (x * x + y * y <= 4.0 && it < MAX) {
      const xt: number = x * x - y * y + cx;
      y = 2.0 * x * y + cy;
      x = xt;
      it++;
    }
    if (it === MAX) inside++;
  }
}
console.log("RESULT " + inside);
