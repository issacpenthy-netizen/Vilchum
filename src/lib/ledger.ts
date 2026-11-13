import type { Prisma } from "@prisma/client";

export type ReceiptKind = "SCAN_VERIFIED" | "CASHOUT_REQUESTED" | "CASHOUT_PAID" | "CASHOUT_REFUNDED";
type Tx = Prisma.TransactionClient;

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
