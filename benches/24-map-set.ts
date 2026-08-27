// Map and Set with string and numeric keys.
const N: number = 3000000;
const m: Map<string, number> = new Map();
const s: Set<number> = new Set();

let seed: number = 7;
for (let i: number = 0; i < N; i++) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  m.set("k" + (seed % 750000), i);
  s.add(seed % 750000);
}

let hits: number = 0;
for (let i: number = 0; i < N; i++) {
  if (m.has("k" + (i % 750000))) hits++;
  if (s.has(i % 750000)) hits++;
}
console.log("RESULT " + (m.size + s.size + hits));
