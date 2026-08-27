// Tight arithmetic loop.
let sum: number = 0;
for (let i: number = 0; i < 1000000000; i++) {
  sum += i % 7;
}
console.log("RESULT " + sum);
