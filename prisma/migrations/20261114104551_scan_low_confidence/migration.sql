-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Scan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "imageHash" TEXT NOT NULL,
    "cans" INTEGER NOT NULL,
    "bottles" INTEGER NOT NULL,
    "confidence" REAL NOT NULL,
    "lowConfidence" BOOLEAN NOT NULL DEFAULT false,
    "estimator" TEXT,
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
INSERT INTO "new_Scan" ("bottles", "cans", "confidence", "createdAt", "id", "imageHash", "imagePath", "points", "reason", "status", "userId", "verifiedAt", "verifiedBottles", "verifiedCans", "verifiedPoints") SELECT "bottles", "cans", "confidence", "createdAt", "id", "imageHash", "imagePath", "points", "reason", "status", "userId", "verifiedAt", "verifiedBottles", "verifiedCans", "verifiedPoints" FROM "Scan";
DROP TABLE "Scan";
ALTER TABLE "new_Scan" RENAME TO "Scan";
CREATE INDEX "Scan_userId_createdAt_idx" ON "Scan"("userId", "createdAt");
CREATE INDEX "Scan_status_createdAt_idx" ON "Scan"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
