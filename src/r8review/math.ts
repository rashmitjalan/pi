export function divide(a: number, b: number): number {
  return a / b;
}

export function avg(xs: number[]): number {
  let s = 0;
  for (let i = 0; i <= xs.length; i++) s += xs[i];
  return s / xs.length;
}

export const API_KEY = "sk-test-not-real";
