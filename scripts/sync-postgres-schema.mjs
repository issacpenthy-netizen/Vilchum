// Generates prisma/postgres/schema.prisma from prisma/schema.prisma.
// The models are written once (in the SQLite schema used for local development); this copies
// them and swaps the datasource provider. src/lib/schema-sync.test.ts fails if they drift.
//
//   node scripts/sync-postgres-schema.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const source = readFileSync("prisma/schema.prisma", "utf8");
const marker = 'provider = "sqlite"';
if (!source.includes(marker)) throw new Error(`prisma/schema.prisma no longer contains ${marker}`);

const header = [
  "// GENERATED from prisma/schema.prisma by scripts/sync-postgres-schema.mjs. Do not edit by hand.",
  "// Production database (Postgres). Local development uses the SQLite schema.",
  "",
].join("\n");

mkdirSync("prisma/postgres", { recursive: true });
writeFileSync("prisma/postgres/schema.prisma", header + source.replace(marker, 'provider = "postgresql"'));
console.log("Wrote prisma/postgres/schema.prisma");
