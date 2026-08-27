// Higher-order functions and closures.
function makeAdder(n: number): (x: number) => number {
  // A closed form for `x + n` would be folded at -O3; the mix keeps the calls real.
  return function (x: number): number { return (x * 31 + n) % 1000003; };
}

function applyN(f: (x: number) => number, times: number, start: number): number {
  let v: number = start;
  for (let i: number = 0; i < times; i++) v = f(v);
  return v;
}

let total: number = 0;
for (let k: number = 1; k <= 2500; k++) {
  const add = makeAdder(k % 5);
  total += applyN(add, 100000, k);
}

const nums: number[] = [];
for (let i: number = 0; i < 1000000; i++) nums.push(i);
const mapped: number[] = nums.map(function (v: number): number { return v * 2; });
const filtered: number[] = mapped.filter(function (v: number): boolean { return v % 3 === 0; });
const reduced: number = filtered.reduce(function (a: number, b: number): number { return a + b; }, 0);

console.log("RESULT " + (total + reduced));
