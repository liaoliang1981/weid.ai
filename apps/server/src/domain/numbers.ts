// Accepts the several ways a Weid number can be written in the wild —
// "WEID-10024", "WEID10024", "10024", "@10024", "10024@weid.ai" — and
// normalizes to a bigint. Parsing stays liberal even though display moved
// to the WEID-{number} format (see formatNumber), so old links/messages
// written with "@" still resolve.
export function normalizeNumber(input: string): bigint | null {
  let s = input.trim();
  s = s.replace(/^WEID-?/i, "");
  if (s.startsWith("@")) s = s.slice(1);
  s = s.replace(/@weid\.ai$/i, "");
  if (!/^[0-9]+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

// The display format everywhere a number is shown to a human — "@10024"
// reads as a social-media handle/mention, which isn't what a Weid number
// is, so it's spelled out as "WEID-10024" instead.
export function formatNumber(number: bigint): string {
  return `WEID-${number}`;
}
