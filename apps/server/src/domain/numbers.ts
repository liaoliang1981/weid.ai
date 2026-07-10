// Accepts the three ways a Weid number can be written in the wild —
// "@10024", "10024", "10024@weid.ai" — and normalizes to a bigint.
export function normalizeNumber(input: string): bigint | null {
  let s = input.trim();
  if (s.startsWith("@")) s = s.slice(1);
  s = s.replace(/@Weid\.ai$/i, "");
  if (!/^[0-9]+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}
