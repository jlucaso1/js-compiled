// Inheritance and virtual method dispatch.
class Shape {
  x: number;
  y: number;
  constructor(x: number, y: number) { this.x = x; this.y = y; }
  area(): number { return 0; }
  describe(): number { return this.area() + this.x + this.y; }
}

class Circle extends Shape {
  r: number;
  constructor(x: number, y: number, r: number) { super(x, y); this.r = r; }
  area(): number { return Math.PI * this.r * this.r; }
}

class Rect extends Shape {
  w: number;
  h: number;
  constructor(x: number, y: number, w: number, h: number) { super(x, y); this.w = w; this.h = h; }
  area(): number { return this.w * this.h; }
}

const N: number = 500000;
const shapes: Shape[] = [];
for (let i: number = 0; i < N; i++) {
  if (i % 2 === 0) shapes.push(new Circle(i % 10, i % 7, (i % 5) + 1));
  else shapes.push(new Rect(i % 10, i % 7, (i % 4) + 1, (i % 6) + 1));
}

// Mutating each object stops the dispatch loop from being hoisted away.
let total: number = 0;
for (let r: number = 0; r < 200; r++) {
  for (let i: number = 0; i < N; i++) {
    const s: Shape = shapes[i];
    s.x = (s.x + 1) % 10;
    total += s.describe();
  }
}
console.log("RESULT " + total.toFixed(3));
