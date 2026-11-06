// Terminal output for the demo: one line per step, explorer links on their own line.

const color = (code: number) => (s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);

export const bold = color(1);
export const dim = color(2);
export const red = color(31);
export const green = color(32);
export const yellow = color(33);
export const cyan = color(36);

export function say(icon: string, text: string): void {
  console.log(`${icon} ${text}`);
}

export function detail(text: string): void {
  console.log(`   ${text}`);
}

export function short(address: { toString(): string } | string): string {
  const s = address.toString();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
