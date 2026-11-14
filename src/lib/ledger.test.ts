import { test } from "node:test";
import assert from "node:assert/strict";
import { isSerializationFailure, serializableMoneyTransaction } from "./ledger";

const conflict = Object.assign(new Error("Transaction failed due to a write conflict or a deadlock. Please retry your transaction"), { code: "P2034" });

test("money transactions run at SERIALIZABLE isolation", async () => {
  let level: string | undefined;
  await serializableMoneyTransaction(async (options) => { level = options.isolationLevel; return true; });
  assert.equal(level, "Serializable");
});

test("a serialization conflict is retried, then succeeds", async () => {
  let calls = 0;
  const result = await serializableMoneyTransaction(async () => { calls++; if (calls < 3) throw conflict; return "debited once"; });
  assert.equal(result, "debited once");
  assert.equal(calls, 3);
});

test("retries stop after the limit and surface the conflict", async () => {
  let calls = 0;
  await assert.rejects(serializableMoneyTransaction(async () => { calls++; throw conflict; }), /write conflict/);
  assert.equal(calls, 3);
});

test("other errors are never retried (no double debit on a real failure)", async () => {
  let calls = 0;
  await assert.rejects(serializableMoneyTransaction(async () => { calls++; throw new Error("unique constraint"); }), /unique constraint/);
  assert.equal(calls, 1);
});

test("Postgres serialization errors are recognised", () => {
  assert.equal(isSerializationFailure(conflict), true);
  assert.equal(isSerializationFailure(new Error("ERROR: could not serialize access due to concurrent update (SQLSTATE 40001)")), true);
  assert.equal(isSerializationFailure(new Error("balance too low")), false);
  assert.equal(isSerializationFailure(null), false);
});
