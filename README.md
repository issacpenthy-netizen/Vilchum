# VilChum

## Setup

1. Copy `.env.example` to `.env`, add a valid `GEMINI_API_KEY` for live photo checks, and set a local `ADMIN_PASSWORD`. For Google sign-in, create a Google OAuth web client, authorize `http://localhost:3000/api/auth/google/callback`, and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. Without Google credentials the button shows a setup message. Without a Gemini key, development uses a clearly labelled MOCK verifier. `DEV_OTP=true` enables the demo code `123456`.
2. Run `npm install && npx prisma migrate dev && npm run dev`. The dev command seeds the demo account with 3,420 points and two past scans.
3. Open http://localhost:3000. Admin demo controls are at http://localhost:3000/admin.

## Demo script

1. Choose Get started, enter `12345678`, and verify with `123456`. The seeded account starts with 3,420 points.
2. Open Scan, take or choose a clear photo of cans or plastic bottles, review it, and submit. Gemini returns the counts and the app validates confidence before crediting points. Without a key, the local MOCK verifier demonstrates the flow with one can and one bottle. Claim to return home.
3. Add points until the balance reaches 5,000, open Cash out, choose an amount, select ABA, ACLEDA, or Visa, enter an account number, and confirm. The local sandbox marks the payout paid after three seconds and returns a fake provider reference.

## Real-world gaps

- SMS provider: the sendOtp adapter logs development codes; no SMS service is integrated.
- Bank APIs: ABA, ACLEDA, and Visa are sandbox adapters only. Real integrations require bank partner agreements and credentials.
- Fraud model: local perceptual hashes and Gemini confidence checks are demo safeguards, not a production fraud detection system.
