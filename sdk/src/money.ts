// USDC amounts are bigint base units everywhere. No floats near money.

export const USDC_DECIMALS = 6;
const SCALE = 1_000_000n;

/** "0.05", "$3", "3.00 USDC" -> base units (50_000n, 3_000_000n). Integer math only. */
export function parseUsdc(input: string): bigint {
  const s = input
    .trim()
    .replace(/^\$/, "")
    .replace(/\s*usdc?$/i, "")
    .trim();
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw new Error(`Invalid amount "${input}": use a number like 0.05 (at most 6 decimals)`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? "").padEnd(USDC_DECIMALS, "0"));
  return whole * SCALE + frac;
}

/** Base units -> "$0.05", "$1.00", "$0.000001". */
export function formatUsdc(base: bigint | number | string): string {
  const v = BigInt(base);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  let frac = (abs % SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${sign}$${abs / SCALE}.${frac}`;
}
