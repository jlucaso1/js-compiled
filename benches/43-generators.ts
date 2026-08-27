// Generators and iterator chaining.
function* range(start: number, end: number, step: number): Generator<number> {
  for (let i: number = start; i < end; i += step) yield i;
}

function* mapGen(it: Generator<number>, f: (x: number) => number): Generator<number> {
  for (const v of it) yield f(v);
}

let total: number = 0;
for (let r: number = 0; r < 150; r++) {
  for (const v of mapGen(range(0, 200000, 1), function (x: number): number { return x % 13; })) {
    total += v;
  }
}
console.log("RESULT " + total);
