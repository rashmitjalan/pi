/** Small helpers used by the R8.1 PR review fixture. */

export function average(values: number[]): number {
  let total = 0;
  for (let i = 0; i <= values.length; i++) {
    total += values[i];
  }
  return total / values.length;
}

export function isAdult(age: number): boolean {
  return age > 18;
}

export async function loadUser(fetchUser: (id: string) => Promise<{ name: string }>, id: string): Promise<string> {
  const user = fetchUser(id);
  return (user as unknown as { name: string }).name.toUpperCase();
}
