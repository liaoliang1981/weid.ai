import { sql } from "drizzle-orm";
import type { Db } from "./index.js";

/**
 * Sequential, gap-free number allocation starting at 10000. INSERT ... ON
 * CONFLICT DO UPDATE is a single atomic statement under Postgres row
 * locking, so this both seeds the singleton row on first call and
 * increments it on every later call — concurrent callers serialize on the
 * `number_pool` row and never observe or return the same number twice.
 */
export async function allocateNumber(db: Db): Promise<bigint> {
  const rows = await db.execute<{ assigned: bigint }>(sql`
    INSERT INTO number_pool (id, next_number) VALUES ('singleton', 10001)
    ON CONFLICT (id) DO UPDATE SET next_number = number_pool.next_number + 1
    RETURNING next_number - 1 AS assigned
  `);
  const assigned = rows[0]?.assigned;
  if (assigned === undefined) {
    throw new Error("failed to allocate a number from number_pool");
  }
  return BigInt(assigned);
}
