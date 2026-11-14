// VilChum money rules (decisions D1–D4 and the two-phase crediting law).
// The ledger currency is KHR and 1 point = 1 KHR, so points and riel are the same integer.
// Nothing in this file reads or writes USD amounts; USD is formatted for display only.

/** D1: points per item. 50 cans = 2,500 pt = 1 kg; 100 bottles = 1,000 pt = 1 kg. */
export const POINTS_PER_ITEM = { cans: 50, bottles: 10 } as const;
/** D1: items per kilogram, used only to show an estimated weight. */
export const ITEMS_PER_KG = { cans: 50, bottles: 100 } as const;
/** D3: minimum cash-out, in points (= KHR). */
export const MIN_CASHOUT = 1000;
/** D3: cash-out fee in v1. Shown to users as "no fee". */
export const CASHOUT_FEE = 0;

function assertCount(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} must be a whole number of items, 0 or more.`);
}

/** D4: round half up to a whole riel. Only the verified phase may call this. */
export function roundHalfUp(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Amount must be a finite number, 0 or more.");
  return Math.floor(value + 0.5);
}

/**
 * Phase 1: estimate from a photo. Never rounded and never spendable (shown with "≈").
 * With the D1 rates this is already whole, but it is deliberately left unrounded.
 */
export function estimate(cans: number, bottles: number) {
  assertCount(cans, "Cans"); assertCount(bottles, "Bottles");
  return {
    points: cans * POINTS_PER_ITEM.cans + bottles * POINTS_PER_ITEM.bottles,
    kg: cans / ITEMS_PER_KG.cans + bottles / ITEMS_PER_KG.bottles,
  };
}

/**
 * Phase 2: points from a driver's counted items. The only amount that may enter the ledger.
 * Computed from the counts directly (never from a rounded estimate), then rounded once.
 */
export function verifiedPoints(cans: number, bottles: number) {
  assertCount(cans, "Counted cans"); assertCount(bottles, "Counted bottles");
  return roundHalfUp(cans * POINTS_PER_ITEM.cans + bottles * POINTS_PER_ITEM.bottles);
}

/** D3: what a cash-out request pays out after the fee. */
export function cashoutQuote(amount: number) {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError("Cash-out amount must be whole riel.");
  return { amount, fee: CASHOUT_FEE, receive: amount - CASHOUT_FEE, meetsMinimum: amount >= MIN_CASHOUT };
}

/**
 * D2: secondary USD line for display. Returns null when the live rate is missing or invalid,
 * which callers treat as "hide the USD line". The result is a label, never an amount to compute with.
 */
export function usdLabel(khr: number, khrPerUsd: number | null | undefined) {
  if (typeof khrPerUsd !== "number" || !Number.isFinite(khrPerUsd) || khrPerUsd <= 0 || !Number.isFinite(khr)) return null;
  return `≈ US$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(khr / khrPerUsd)}`;
}
