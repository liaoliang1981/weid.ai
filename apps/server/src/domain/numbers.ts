// Accepts the three ways a 2088 number can be written in the wild —
// "@208824", "208824", "208824@2088.ai" — and normalizes to a bigint.
export function normalizeNumber(input: string): bigint | null {
  let s = input.trim();
  if (s.startsWith("@")) s = s.slice(1);
  s = s.replace(/@2088\.ai$/i, "");
  if (!/^[0-9]+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}
