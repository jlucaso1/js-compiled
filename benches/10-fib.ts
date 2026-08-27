// Deep recursion: function call cost.
function fib(n: number): number {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}

// Argument varies per iteration. Otherwise an AOT compiler folds the whole loop
// into a single call (fib is pure), while V8/JSC run all N.
let acc: number = 0;
for (let i: number = 0; i < 6; i++) acc += fib(33 + i);
console.log("RESULT " + acc);
