// Regular expressions with capture groups.
const N: number = 60000;
const lines: string[] = [];
for (let i: number = 0; i < N; i++) {
  lines.push("2026-08-26T10:" + (i % 60) + ":00 [INFO] user=" + i + " action=login latency=" + (i % 997) + "ms");
}

const re: RegExp = /^(\d{4})-(\d{2})-(\d{2})T[\d:]+ \[(\w+)\] user=(\d+) action=(\w+) latency=(\d+)ms$/;
let matched: number = 0;
let latency: number = 0;
for (let r: number = 0; r < 100; r++) {
  for (let i: number = 0; i < N; i++) {
    const m = re.exec(lines[i]);
    if (m !== null) {
      matched++;
      latency += parseInt(m[7], 10);
    }
  }
}
console.log("RESULT " + (matched + latency));
