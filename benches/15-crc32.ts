// Integer bitwise ops over a lookup table.
const table: Int32Array = new Int32Array(256);
for (let n: number = 0; n < 256; n++) {
  let c: number = n;
  for (let k: number = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  table[n] = c | 0;
}

const SIZE: number = 8 * 1024 * 1024;
const buf: Uint8Array = new Uint8Array(SIZE);
let seed: number = 123456789;
for (let i: number = 0; i < SIZE; i++) {
  seed = (seed * 1103515245 + 12345) | 0;
  buf[i] = (seed >>> 16) & 0xff;
}

function crc32(data: Uint8Array): number {
  let c: number = -1;
  for (let i: number = 0; i < data.length; i++) {
    c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

// The buffer changes each round, otherwise the identical calls collapse to one.
let acc: number = 0;
for (let r: number = 0; r < 40; r++) {
  buf[r] = (buf[r] + 1) & 0xff;
  acc = (acc + crc32(buf) + r) % 4294967296;
}
console.log("RESULT " + acc);
