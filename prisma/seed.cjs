const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();

async function main() {
  const user = await db.user.upsert({
    where: { phone: "+85512345678" },
    update: {},
    create: { phone: "+85512345678" },
  });
  if (await db.scan.count({ where: { userId: user.id } })) return;

  for (const [index, points] of [1660, 1760].entries()) {
    const createdAt = new Date(Date.now() - (index + 1) * 86_400_000);
    const scanId = `demo-scan-${index + 1}`;
    await db.scan.create({
      data: {
        id: scanId,
        userId: user.id,
        imagePath: "demo-seed.jpg",
        imageHash: (index === 0 ? "0" : "1").repeat(64),
        cans: index === 0 ? 20 : 22,
        bottles: index === 0 ? 8 : 10,
        confidence: 0.94,
        points,
        status: "APPROVED",
        createdAt,
      },
    });
    await db.ledgerEntry.create({
      data: { userId: user.id, delta: points, type: "SCAN", refId: scanId, createdAt },
    });
  }
}

main()
  .catch((error) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
