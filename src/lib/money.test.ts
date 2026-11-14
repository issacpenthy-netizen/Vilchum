import { test } from "node:test";
import assert from "node:assert/strict";
import { CASHOUT_FEE, MIN_CASHOUT, POINTS_PER_ITEM, cashoutQuote, estimate, roundHalfUp, usdLabel, verifiedPoints } from "./money";

test("D1: item rates match the per-kilogram rates", () => {
  assert.equal(POINTS_PER_ITEM.cans, 50);
  assert.equal(POINTS_PER_ITEM.bottles, 10);
  assert.deepEqual(estimate(50, 0), { points: 2500, kg: 1 });
  assert.deepEqual(estimate(0, 100), { points: 1000, kg: 1 });
  assert.equal(verifiedPoints(50, 0), 2500);
  assert.equal(verifiedPoints(0, 100), 1000);
});

test("D1: mixed counts add up per item", () => {
  assert.equal(estimate(3, 7).points, 220);
  assert.equal(verifiedPoints(3, 7), 220);
  assert.equal(verifiedPoints(0, 0), 0);
});

test("D4: round half up to whole riel", () => {
  assert.equal(roundHalfUp(2.5), 3);
  assert.equal(roundHalfUp(2.4999), 2);
  assert.equal(roundHalfUp(927.5), 928);
  assert.equal(roundHalfUp(1000), 1000);
  assert.throws(() => roundHalfUp(-1));
  assert.throws(() => roundHalfUp(Number.NaN));
});

test("D4: counts must be whole items, so no fractional points reach the ledger", () => {
  assert.throws(() => verifiedPoints(1.5, 0));
  assert.throws(() => verifiedPoints(-1, 0));
  assert.throws(() => estimate(0, -2));
  assert.ok(Number.isInteger(verifiedPoints(123, 456)));
});

test("D3: minimum is 1,000 riel and v1 charges no fee", () => {
  assert.equal(MIN_CASHOUT, 1000);
  assert.equal(CASHOUT_FEE, 0);
  assert.deepEqual(cashoutQuote(1000), { amount: 1000, fee: 0, receive: 1000, meetsMinimum: true });
  assert.equal(cashoutQuote(999).meetsMinimum, false);
  assert.throws(() => cashoutQuote(10.5));
});

test("D2: USD is a display label and hides when the rate is unusable", () => {
  assert.equal(usdLabel(4100, 4100), "≈ US$1.00");
  assert.equal(usdLabel(2500, 4000), "≈ US$0.63");
  assert.equal(usdLabel(2500, null), null);
  assert.equal(usdLabel(2500, 0), null);
  assert.equal(usdLabel(2500, Number.NaN), null);
  assert.equal(typeof usdLabel(1, 4000), "string");
});
