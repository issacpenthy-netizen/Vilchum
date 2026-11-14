import { Prisma } from "@prisma/client";

export type ReceiptKind = "SCAN_VERIFIED" | "CASHOUT_REQUESTED" | "CASHOUT_PAID" | "CASHOUT_REFUNDED";
type Tx = Prisma.TransactionClient;

/** Postgres aborts one of two conflicting serializable transactions; Prisma reports it as P2034. */
export function isSerializationFailure(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : "";
  return code === "P2034" || /could not serialize|40001|write conflict|deadlock/i.test(message);
}

/**
 * Runs a read-then-write money transaction (e.g. "check balance, then debit") at SERIALIZABLE
 * isolation, retrying when the database aborts it because of a concurrent conflict.
 * On Postgres' default READ COMMITTED, two simultaneous cash-outs could both see the same
 * balance and both debit it. SQLite already serialises writes, so this is a no-op there.
 */
export async function serializableMoneyTransaction<T>(run: (options: { isolationLevel: Prisma.TransactionIsolationLevel }) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt >= attempts || !isSerializationFailure(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 25));
    }
  }
}

/** Spendable balance: only ledger entries count. Estimated scans never reach the ledger. */
export async function balanceOf(tx: Tx, userId: string) {
  const total = await tx.ledgerEntry.aggregate({ where: { userId }, _sum: { delta: true } });
  return total._sum.delta ?? 0;
}

/**
 * Records one money transition: the ledger entry (when the balance changes) and its receipt,
 * in the caller's transaction so neither can exist without the other.
 */
export async function recordTransition(tx: Tx, input: { userId: string; kind: ReceiptKind; amount: number; delta: number; refId: string; details: Record<string, unknown> }) {
  if (!Number.isInteger(input.amount) || input.amount < 0 || !Number.isInteger(input.delta)) throw new RangeError("Ledger amounts must be whole riel.");
  if (input.delta !== 0) await tx.ledgerEntry.create({ data: { userId: input.userId, delta: input.delta, type: input.kind, refId: input.refId } });
  const balanceAfter = await balanceOf(tx, input.userId);
  return tx.receipt.create({ data: { userId: input.userId, kind: input.kind, amount: input.amount, delta: input.delta, balanceAfter, refId: input.refId, details: JSON.stringify(input.details) } });
}

export function receiptNumber(id: string) { return `VC-${id.slice(-8).toUpperCase()}`; }

export function publicReceipt(receipt: { id: string; kind: string; amount: number; delta: number; balanceAfter: number; refId: string; details: string; createdAt: Date }) {
  let details: Record<string, unknown> = {};
  try { details = JSON.parse(receipt.details) as Record<string, unknown>; } catch { details = {}; }
  return { id: receipt.id, number: receiptNumber(receipt.id), kind: receipt.kind, amount: receipt.amount, delta: receipt.delta, balanceAfter: receipt.balanceAfter, refId: receipt.refId, details, createdAt: receipt.createdAt };
}
