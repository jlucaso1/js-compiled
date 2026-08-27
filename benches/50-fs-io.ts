// File I/O through node:fs.
import { writeFileSync, readFileSync, appendFileSync, unlinkSync } from "node:fs";

const path: string = "bench-fs-io.tmp";
const chunk: string = "linha de teste para io sequencial 0123456789\n";

let payload: string = "";
for (let i: number = 0; i < 2000; i++) payload += chunk;

writeFileSync(path, payload);
for (let r: number = 0; r < 200; r++) {
  appendFileSync(path, payload);
}

let bytes: number = 0;
for (let r: number = 0; r < 50; r++) {
  const data: string = readFileSync(path, "utf8");
  bytes += data.length;
}
unlinkSync(path);
console.log("RESULT " + bytes);
