-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "refId" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Receipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "providerRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Payout" ("account", "amount", "createdAt", "id", "method", "providerRef", "status", "userId") SELECT "account", "amount", "createdAt", "id", "method", "providerRef", "status", "userId" FROM "Payout";
DROP TABLE "Payout";
ALTER TABLE "new_Payout" RENAME TO "Payout";
CREATE INDEX "Payout_userId_createdAt_idx" ON "Payout"("userId", "createdAt");
CREATE TABLE "new_Scan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "imageHash" TEXT NOT NULL,
    "cans" INTEGER NOT NULL,
    "bottles" INTEGER NOT NULL,
    "confidence" REAL NOT NULL,
    "points" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "reason" TEXT,
    "verifiedCans" INTEGER,
    "verifiedBottles" INTEGER,
    "verifiedPoints" INTEGER,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Scan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Scan" ("bottles", "cans", "confidence", "createdAt", "id", "imageHash", "imagePath", "points", "reason", "status", "userId") SELECT "bottles", "cans", "confidence", "createdAt", "id", "imageHash", "imagePath", "points", "reason", "status", "userId" FROM "Scan";
DROP TABLE "Scan";
ALTER TABLE "new_Scan" RENAME TO "Scan";
CREATE INDEX "Scan_userId_createdAt_idx" ON "Scan"("userId", "createdAt");
CREATE INDEX "Scan_status_createdAt_idx" ON "Scan"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Receipt_userId_createdAt_idx" ON "Receipt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Receipt_refId_idx" ON "Receipt"("refId");

-- Data: map pre-two-phase states. APPROVED scans were already credited to the ledger,
-- so they become VERIFIED with the credited counts; nothing is re-credited or debited.
UPDATE "Scan" SET "status" = 'VERIFIED', "verifiedCans" = "cans", "verifiedBottles" = "bottles", "verifiedPoints" = "points", "verifiedAt" = "createdAt" WHERE "status" = 'APPROVED';
UPDATE "Scan" SET "status" = 'ESTIMATED' WHERE "status" = 'PENDING';
-- PROCESSING payouts were already debited; they now wait for a manual payout.
UPDATE "Payout" SET "status" = 'REQUESTED' WHERE "status" = 'PROCESSING';
