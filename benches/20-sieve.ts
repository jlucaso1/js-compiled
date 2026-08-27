// Sieve of Eratosthenes: linear memory over a typed array.
const LIMIT: number = 100000000;
const flags: Uint8Array = new Uint8Array(LIMIT + 1);
let count: number = 0;

for (let i: number = 2; i <= LIMIT; i++) {
  if (flags[i] === 0) {
    count++;
    for (let j: number = i * 2; j <= LIMIT; j += i) flags[j] = 1;
  }
}
console.log("RESULT " + count);
