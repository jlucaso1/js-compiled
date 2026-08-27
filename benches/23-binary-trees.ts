// Heavy object allocation, GC pressure.
const DEPTH: number = 19;

class Node {
  left: Node | null;
  right: Node | null;
  constructor(left: Node | null, right: Node | null) {
    this.left = left;
    this.right = right;
  }
}

function bottomUp(depth: number): Node {
  if (depth > 0) return new Node(bottomUp(depth - 1), bottomUp(depth - 1));
  return new Node(null, null);
}

function check(n: Node): number {
  const l: Node | null = n.left;
  const r: Node | null = n.right;
  if (l === null || r === null) return 1;
  return 1 + check(l) + check(r);
}

let total: number = 0;
const stretch: Node = bottomUp(DEPTH + 1);
total += check(stretch);

const longLived: Node = bottomUp(DEPTH);
for (let d: number = 4; d <= DEPTH; d += 2) {
  const iterations: number = 1 << (DEPTH - d + 4);
  let sum: number = 0;
  for (let i: number = 0; i < iterations; i++) sum += check(bottomUp(d));
  total += sum;
}
total += check(longLived);
console.log("RESULT " + total);
