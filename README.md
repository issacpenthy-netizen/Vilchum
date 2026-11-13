# VilChum

## Setup

1. Copy `.env.example` to `.env`. Set `SESSION_SECRET` to a random value (`openssl rand -hex 32`), add a valid `GEMINI_API_KEY` for live photo checks, and set a local `ADMIN_PASSWORD`. For Google sign-in, create a Google OAuth web client, authorize `http://localhost:3000/api/auth/google/callback`, and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. Without Google credentials the button shows a setup message. Without a Gemini key, development uses a clearly labelled MOCK verifier. `DEV_OTP=true` enables the demo code `123456` in development only.
2. Run `npm install && npx prisma migrate dev && npm run dev`. `migrate dev` creates the local database `prisma/dev.db` (it is not in git), and the dev command seeds a demo account with two verified pickups (2,280 points) and one estimate waiting for pickup.
3. Open http://localhost:3000. Driver verification and manual cash-outs are at http://localhost:3000/admin.

Run the money-rule and configuration tests with `npm test`.

## Configuration checks

The server checks its configuration when it starts (`src/instrumentation.ts`, rules in `src/lib/env.ts`).

- **Production** (`next start`) refuses to start if `DEV_OTP=true`, `SESSION_SECRET` is missing, a placeholder, or under 32 characters, `ADMIN_PASSWORD` is missing, a default, or under 16 characters, `GEMINI_API_KEY` or `DATABASE_URL` is missing, or `GOOGLE_REDIRECT_URI` is not an https public URL.
- **Development** prints the same problems as warnings so local demos keep working, but still needs `SESSION_SECRET` and `DATABASE_URL`.
- There is no built-in session secret and the demo sign-in code is ignored in production, even if the startup check were bypassed.

Never commit databases, `.env` files or uploaded photos; `.gitignore` excludes them because they contain personal data.

## Demo script

1. Choose Get started, enter `12345678`, and verify with `123456`.
2. Open Scan, take or choose a clear photo of cans or plastic bottles, review it, and submit. Gemini returns the counts as an estimate (≈); estimates are never spendable. Without a key, the local MOCK verifier estimates one can and one bottle.
3. In `/admin`, enter the counted items for the pickup, review the credit, and confirm. The points become spendable balance and a receipt is issued.
4. Open Cash out (minimum 1,000៛, no fee), choose ABA or ACLEDA, enter an account number, and confirm. The request is debited with a receipt and waits in `/admin`, where it is marked paid (with the bank reference) or failed (which refunds the points).

## Real-world gaps

- Sign-in: phone codes are only logged in development; no SMS provider is integrated. Planned replacement: Better Auth with Telegram.
- Payouts: the rail is stubbed in v1; cash-outs are paid by hand and marked in `/admin`.
- Fraud model: local perceptual hashes and Gemini confidence checks are demo safeguards, not a production fraud detection system.
