import readlineAsync from "node:readline/promises";

export async function question(question: string) {
  const rl = readlineAsync.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return rl.question(question).finally(() => {
    rl.close();
  });
}
