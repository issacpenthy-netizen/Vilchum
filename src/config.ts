export const rules = {
  rates: { cans: 3000, bottles: 1000 },
  weightGrams: { cans: 15, bottles: 20 },
  minimumCashout: 5000,
  maxScansPerDay: 10,
  confidenceThreshold: 0.72,
} as const;

export const pickup = {
  city: "Phnom Penh",
  khans: [
    "Chamkar Mon",
    "Doun Penh",
    "Prampir Makara",
    "Tuol Kouk",
    "Dangkao",
    "Mean Chey",
    "Russey Keo",
    "Sen Sok",
    "Por Senchey",
    "Chroy Changvar",
    "Prek Pnov",
    "Chbar Ampov",
    "Boeng Keng Kang",
    "Kamboul",
  ],
} as const;

export function estimate(cans: number, bottles: number) {
  const canKg = cans * rules.weightGrams.cans / 1000;
  const bottleKg = bottles * rules.weightGrams.bottles / 1000;
  return {
    kg: canKg + bottleKg,
    points: Math.round(canKg * rules.rates.cans + bottleKg * rules.rates.bottles),
  };
}
