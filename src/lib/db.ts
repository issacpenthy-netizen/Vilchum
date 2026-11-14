import { PrismaClient } from "@prisma/client";

// Interactive transactions ($transaction(async tx => ...)) default to maxWait 2 s / timeout 5 s.
// On local SQLite (Windows), saving a scan intermittently took 3-15 s waiting for the file lock and
// hit the 5 s limit, returning a 500. These limits are a band-aid for local SQLite; production
// runs on Postgres (prisma/postgres/schema.prisma), where these waits should not occur.
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalDb.prisma ?? new PrismaClient({ transactionOptions: TRANSACTION_OPTIONS });
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
