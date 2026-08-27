// async/await, Promises and microtasks.
function work(n: number): Promise<number> {
  return Promise.resolve(n * 2);
}

async function chain(n: number): Promise<number> {
  let acc: number = 0;
  for (let i: number = 0; i < n; i++) {
    acc += await work(i);
  }
  return acc;
}

async function main(): Promise<void> {
  let total: number = 0;
  total += await chain(6000000);

  const batch: Promise<number>[] = [];
  for (let i: number = 0; i < 500000; i++) batch.push(work(i));
  const results: number[] = await Promise.all(batch);
  for (let i: number = 0; i < results.length; i++) total += results[i];

  console.log("RESULT " + total);
}

main();
