import { describe, expect, it } from "vitest";
import { formatNumber, normalizeNumber } from "./numbers.js";

describe("normalizeNumber", () => {
  it("accepts a bare number", () => {
    expect(normalizeNumber("10024")).toBe(10024n);
  });

  it("accepts the WEID- display format", () => {
    expect(normalizeNumber("WEID-10024")).toBe(10024n);
    expect(normalizeNumber("weid-10024")).toBe(10024n);
    expect(normalizeNumber("WEID10024")).toBe(10024n);
  });

  it("still accepts the legacy @ format", () => {
    expect(normalizeNumber("@10024")).toBe(10024n);
  });

  it("still accepts the protocol email-like format", () => {
    expect(normalizeNumber("10024@weid.ai")).toBe(10024n);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeNumber("  WEID-10024  ")).toBe(10024n);
  });

  it("rejects non-numeric input", () => {
    expect(normalizeNumber("not-a-number")).toBeNull();
    expect(normalizeNumber("WEID-")).toBeNull();
    expect(normalizeNumber("")).toBeNull();
  });
});

describe("formatNumber", () => {
  it("formats as WEID-{number}", () => {
    expect(formatNumber(10024n)).toBe("WEID-10024");
  });
});
