// Money rules (rates, minimum, fee, rounding) live in src/lib/money.ts.
export const rules = {
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
