// Array.prototype.sort with a comparator.
const N: number = 6000000;
const arr: number[] = [];
let seed: number = 42;
for (let i: number = 0; i < N; i++) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  arr.push(seed % 1000000);
}

arr.sort(function (a: number, b: number): number { return a - b; });

let checksum: number = 0;
for (let i: number = 0; i < N; i += 200000) checksum += arr[i];
console.log("RESULT " + checksum);
