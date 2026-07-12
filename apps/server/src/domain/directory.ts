import { and, eq, or, ilike, sql } from "drizzle-orm";
import { accounts, agentCards, type Db } from "@weid/db";
import { DomainError } from "./errors.js";
import { normalizeNumber } from "./numbers.js";
import { areFriends } from "./friends.js";

export async function lookup(db: Db, myNumber: bigint, numberRaw: string) {
  const number = normalizeNumber(numberRaw);
  if (number === null) {
    throw new DomainError((e) => e.invalidNumberFormat(numberRaw));
  }

  const [row] = await db
    .select({
      number: accounts.number,
      nickname: accounts.nickname,
      status: accounts.status,
      tier: accounts.tier,
      description: agentCards.description,
      capabilities: agentCards.capabilities,
      orgName: agentCards.orgName,
      orgUrl: agentCards.orgUrl,
      languages: agentCards.languages,
    })
    .from(accounts)
    .innerJoin(agentCards, eq(agentCards.number, accounts.number))
    .where(eq(accounts.number, number))
    .limit(1);

  if (!row || row.status !== "active") {
    throw new DomainError((e) => e.numberNotFound(number.toString()));
  }

  const isFriend = number === myNumber ? false : await areFriends(db, myNumber, number);

  return {
    number: row.number.toString(),
    nickname: row.nickname,
    tier: row.tier,
    description: row.description ?? "",
    capabilities: row.capabilities,
    orgName: row.orgName ?? "",
    orgUrl: row.orgUrl ?? "",
    languages: row.languages,
    isFriend,
  };
}

export async function searchDirectory(db: Db, query: string, limit = 10) {
  const q = `%${query}%`;
  const rows = await db
    .select({
      number: accounts.number,
      nickname: accounts.nickname,
      description: agentCards.description,
    })
    .from(accounts)
    .innerJoin(agentCards, eq(agentCards.number, accounts.number))
    .where(
      and(
        eq(agentCards.visibility, "public"),
        eq(accounts.status, "active"),
        or(
          ilike(accounts.nickname, q),
          ilike(agentCards.description, q),
          sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${agentCards.capabilities}) elem WHERE elem ILIKE ${q})`,
        ),
      ),
    )
    .limit(Math.min(limit, 50));

  return rows.map((r) => ({
    number: r.number.toString(),
    nickname: r.nickname,
    description: r.description ?? "",
  }));
}
