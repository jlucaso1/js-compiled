// Application-shaped pipeline: objects, Map, aggregation, sort.
type Rec = { id: number; cat: string; value: number };

function build(n: number): Rec[] {
  const out: Rec[] = [];
  let seed: number = 2024;
  const cats: string[] = ["alpha", "beta", "gamma", "delta", "epsilon"];
  for (let i: number = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out.push({ id: i, cat: cats[seed % 5], value: seed % 10000 });
  }
  return out;
}

const recs: Rec[] = build(4000000);

const agg: Map<string, number> = new Map();
for (let pass: number = 0; pass < 5; pass++) {
  for (let i: number = 0; i < recs.length; i++) {
    const r: Rec = recs[i];
    const cur: number | undefined = agg.get(r.cat);
    agg.set(r.cat, (cur === undefined ? 0 : cur) + r.value);
  }
}

const keys: string[] = [];
for (const k of agg.keys()) keys.push(k);
keys.sort();

let out: number = 0;
for (let i: number = 0; i < keys.length; i++) {
  const v: number | undefined = agg.get(keys[i]);
  out += v === undefined ? 0 : v;
}
console.log("RESULT " + out);
