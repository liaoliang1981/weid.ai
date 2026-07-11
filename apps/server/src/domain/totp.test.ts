import { describe, expect, it } from "vitest";
import {
  currentTotpCode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  totpAuthUrl,
  verifyTotpCode,
} from "./totp.js";

describe("totp", () => {
  it("generates a base32 secret", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it("verifies the code it just generated", () => {
    const secret = generateTotpSecret();
    const code = currentTotpCode(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it("rejects a wrong code", () => {
    const secret = generateTotpSecret();
    const code = currentTotpCode(secret);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(verifyTotpCode(secret, wrong)).toBe(false);
  });

  it("rejects malformed input", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "abcdef")).toBe(false);
    expect(verifyTotpCode(secret, "12345")).toBe(false);
  });

  it("matches the RFC 6238 SHA-1 test vector at T=59s", () => {
    // RFC 6238 appendix B, seed "12345678901234567890" (ASCII), base32-encoded.
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const originalNow = Date.now;
    Date.now = () => 59_000;
    try {
      expect(currentTotpCode(secret)).toBe("287082");
    } finally {
      Date.now = originalNow;
    }
  });

  it("builds an otpauth:// URL containing the secret and account label", () => {
    const secret = generateTotpSecret();
    const url = totpAuthUrl(secret, "@10024");
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain(`secret=${secret}`);
    expect(decodeURIComponent(url)).toContain("weid.ai:@10024");
  });

  it("round-trips encryption keyed off the session secret", () => {
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret("some-session-secret", secret);
    expect(decryptTotpSecret("some-session-secret", encrypted)).toBe(secret);
  });

  it("fails to decrypt with the wrong session secret", () => {
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret("session-a", secret);
    expect(() => decryptTotpSecret("session-b", encrypted)).toThrow();
  });
});
