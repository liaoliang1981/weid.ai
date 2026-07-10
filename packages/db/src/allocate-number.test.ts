import { describe, expect, it } from "vitest";
import { createDb } from "./index.js";
import { allocateNumber } from "./allocate-number.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://weid:weid@localhost:5433/weid";

describe("allocateNumber", () => {
  it("hands out unique, gap-free numbers under concurrency", async () => {
    const db = createDb(databaseUrl);
    const results = await Promise.all(Array.from({ length: 50 }, () => allocateNumber(db)));

    const unique = new Set(results.map(String));
    expect(unique.size).toBe(results.length);

    const sorted = results.map(Number).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBe(sorted[i - 1] + 1);
    }
  });
});
