// JSON.parse and JSON.stringify round trips.
const N: number = 100000;
const rows: string[] = [];
let seed: number = 99;
for (let i: number = 0; i < N; i++) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  rows.push('{"id":' + i + ',"name":"user-' + i + '","score":' + (seed % 1000) + ',"active":' + ((i % 2 === 0) ? "true" : "false") + '}');
}
const doc: string = "[" + rows.join(",") + "]";

let checksum: number = 0;
for (let r: number = 0; r < 40; r++) {
  const parsed = JSON.parse(doc);
  for (let i: number = 0; i < parsed.length; i++) checksum += parsed[i].score;
  const back: string = JSON.stringify(parsed);
  checksum += back.length;
}
console.log("RESULT " + checksum);
