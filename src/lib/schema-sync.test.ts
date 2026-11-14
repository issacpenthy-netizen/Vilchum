import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// prisma/postgres/schema.prisma is generated from prisma/schema.prisma. If someone changes a model
// in one and not the other, production (Postgres) silently runs a different schema than local dev.
const strip = (schema: string) => schema
  .split("\n")
  .filter((line) => !line.startsWith("// GENERATED") && !line.startsWith("// Production database"))
  .join("\n")
  .replace(/provider\s*=\s*"(sqlite|postgresql)"/, 'provider = "<db>"')
  .trim();

test("the Postgres schema matches the SQLite schema apart from the provider", () => {
  const sqlite = readFileSync("prisma/schema.prisma", "utf8");
  const postgres = readFileSync("prisma/postgres/schema.prisma", "utf8");
  assert.match(postgres, /provider = "postgresql"/);
  assert.equal(strip(postgres), strip(sqlite), "Run: node scripts/sync-postgres-schema.mjs, then add a Postgres migration (see README).");
});

test("every model has a Postgres migration that creates its table", () => {
  const models = [...readFileSync("prisma/schema.prisma", "utf8").matchAll(/^model (\w+) \{/gm)].map((match) => match[1]!);
  const sql = readdirSync("prisma/postgres/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(`prisma/postgres/migrations/${entry.name}/migration.sql`, "utf8"))
    .join("\n");
  for (const model of models) assert.ok(sql.includes(`CREATE TABLE "${model}"`), `No Postgres migration creates table ${model}`);
  assert.match(readFileSync("prisma/postgres/migrations/migration_lock.toml", "utf8"), /provider = "postgresql"/);
});
