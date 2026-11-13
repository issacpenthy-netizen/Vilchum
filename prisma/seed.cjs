const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();
// Mirrors src/lib/money.ts (D1): 50 points per can, 10 per bottle; 1 point = 1 KHR.
const points = (cans, bottles) => cans * 50 + bottles * 10;

async function main() {
  const user = await db.user.upsert({
    where: { phone: "+85512345678" },
    update: {},
    create: { phone: "+85512345678" },
  });
  if (await db.scan.count({ where: { userId: user.id } })) return;

  // Two pickups already counted by a driver: credited to the ledger, each with a receipt.
  let balance = 0;
  for (const [index, counted] of [{ cans: 20, bottles: 8 }, { cans: 22, bottles: 10 }].entries()) {
    const createdAt = new Date(Date.now() - (2 - index) * 86_400_000);
    const scanId = `demo-scan-${index + 1}`;
    const credit = points(counted.cans, counted.bottles);
    balance += credit;
    await db.scan.create({
      data: {
        id: scanId, userId: user.id, imagePath: "demo-seed.jpg", imageHash: (index === 0 ? "0" : "1").repeat(64),
        cans: counted.cans, bottles: counted.bottles, confidence: 0.94, estimatedPoints: credit, status: "VERIFIED",
        verifiedCans: counted.cans, verifiedBottles: counted.bottles, verifiedPoints: credit, verifiedAt: createdAt, createdAt,
      },
    });
    await db.ledgerEntry.create({ data: { userId: user.id, delta: credit, type: "SCAN_VERIFIED", refId: scanId, createdAt } });
    await db.receipt.create({
      data: {
        userId: user.id, kind: "SCAN_VERIFIED", amount: credit, delta: credit, balanceAfter: balance, refId: scanId, createdAt,
        details: JSON.stringify({ cans: counted.cans, bottles: counted.bottles, estimatedCans: counted.cans, estimatedBottles: counted.bottles, estimatedPoints: credit }),
      },
    });
  }

  // One photo estimate waiting for pickup: not in the ledger, so not spendable.
  await db.scan.create({
    data: {
      id: "demo-scan-3", userId: user.id, imagePath: "demo-seed.jpg", imageHash: "01".repeat(32),
      cans: 12, bottles: 5, confidence: 0.9, estimatedPoints: points(12, 5), status: "ESTIMATED",
    },
  });
}

main()
  .catch((error) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
