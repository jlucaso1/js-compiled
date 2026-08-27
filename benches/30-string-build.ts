// String building and manipulation.
const N: number = 1000000;

let count: number = 0;
let lenSum: number = 0;
let upperLen: number = 0;
let pieceCount: number = 0;

// Each round builds a different string so the rounds cannot be folded together.
for (let r: number = 0; r < 4; r++) {
  const parts: string[] = [];
  for (let i: number = 0; i < N; i++) parts.push("item-" + (i + r) + ";");
  const joined: string = parts.join("");
  for (let i: number = 0; i < joined.length; i++) {
    if (joined.charCodeAt(i) === 59) count++;
  }
  const upper: string = joined.toUpperCase();
  upperLen = upper.length;
  const pieces: string[] = joined.split(";");
  pieceCount = pieces.length;
  for (let i: number = 0; i < pieces.length; i++) lenSum += pieces[i].length;
}

console.log("RESULT " + (count + upperLen + lenSum + pieceCount));
