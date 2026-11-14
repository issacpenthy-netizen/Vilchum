import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEnv } from "./env";

const strong = {
  DATABASE_URL: "postgresql://user:pass@db.example.com:5432/vilchum",
  SESSION_SECRET: "a".repeat(48),
  ADMIN_PASSWORD: "correct-horse-battery-staple",
  GEMINI_API_KEY: "test-gemini-key",
};

test("a complete production config passes", () => {
  assert.deepEqual(checkEnv(strong, "production"), { errors: [], warnings: [] });
});

test("production refuses the demo sign-in code", () => {
  const { errors } = checkEnv({ ...strong, DEV_OTP: "true" }, "production");
  assert.ok(errors.some((message) => message.includes("DEV_OTP")));
});

test("production refuses missing, short or placeholder session secrets", () => {
  for (const SESSION_SECRET of [undefined, "", "short", "replace-with-a-long-random-value", "vilchum-local-session-secret-change-before-deploy"]) {
    const { errors } = checkEnv({ ...strong, SESSION_SECRET }, "production");
    assert.ok(errors.some((message) => message.includes("SESSION_SECRET")), `expected an error for ${SESSION_SECRET}`);
  }
});

test("production refuses a weak or default admin password", () => {
  for (const ADMIN_PASSWORD of [undefined, "change-me", "vilchum-demo"]) {
    const { errors } = checkEnv({ ...strong, ADMIN_PASSWORD }, "production");
    assert.ok(errors.some((message) => message.includes("ADMIN_PASSWORD")), `expected an error for ${ADMIN_PASSWORD}`);
  }
});

test("production requires the photo checker key and a database", () => {
  assert.ok(checkEnv({ ...strong, GEMINI_API_KEY: "" }, "production").errors.some((message) => message.includes("GEMINI_API_KEY")));
  assert.ok(checkEnv({ ...strong, DATABASE_URL: undefined }, "production").errors.some((message) => message.includes("DATABASE_URL")));
});

test("production refuses localhost or plain-http OAuth redirects", () => {
  for (const GOOGLE_REDIRECT_URI of ["http://localhost:3000/api/auth/google/callback", "http://vilchum.example/api/auth/google/callback", "https://127.0.0.1/cb"]) {
    const { errors } = checkEnv({ ...strong, GOOGLE_REDIRECT_URI }, "production");
    assert.ok(errors.some((message) => message.includes("GOOGLE_REDIRECT_URI")), `expected an error for ${GOOGLE_REDIRECT_URI}`);
  }
  assert.deepEqual(checkEnv({ ...strong, GOOGLE_REDIRECT_URI: "https://vilchum.example/api/auth/google/callback" }, "production").errors, []);
});

test("the YOLO estimator replaces the Gemini key requirement", () => {
  const yolo = { ...strong, GEMINI_API_KEY: "", ESTIMATOR_URL: "https://detect.vilchum.example", ESTIMATOR_API_KEY: "k".repeat(40) };
  assert.deepEqual(checkEnv(yolo, "production").errors, []);
  assert.ok(checkEnv({ ...strong, GEMINI_API_KEY: "" }, "production").errors.some((message) => message.includes("ESTIMATOR_URL or GEMINI_API_KEY")));
});

test("production refuses an insecure or keyless estimator", () => {
  const base = { ...strong, ESTIMATOR_API_KEY: "k".repeat(40) };
  for (const ESTIMATOR_URL of ["http://detect.vilchum.example", "https://localhost:8000", "not a url"]) {
    assert.ok(checkEnv({ ...base, ESTIMATOR_URL }, "production").errors.some((message) => message.includes("ESTIMATOR_URL")), `expected an error for ${ESTIMATOR_URL}`);
  }
  for (const ESTIMATOR_API_KEY of [undefined, "short"]) {
    assert.ok(checkEnv({ ...strong, ESTIMATOR_URL: "https://detect.vilchum.example", ESTIMATOR_API_KEY }, "production").errors.some((message) => message.includes("ESTIMATOR_API_KEY")));
  }
  // A local service over http is fine in development.
  assert.deepEqual(checkEnv({ ...base, ESTIMATOR_URL: "http://127.0.0.1:8000" }, "development").errors, []);
});

test("development keeps working with demo settings but warns", () => {
  const result = checkEnv({ DATABASE_URL: "file:./dev.db", SESSION_SECRET: "replace-with-a-long-random-value", ADMIN_PASSWORD: "change-me", DEV_OTP: "true" }, "development");
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.length >= 2);
});

test("development still needs a session secret and a database", () => {
  const result = checkEnv({}, "development");
  assert.ok(result.errors.some((message) => message.includes("SESSION_SECRET")));
  assert.ok(result.errors.some((message) => message.includes("DATABASE_URL")));
});

test("messages never include the secret values themselves", () => {
  const secret = "leaky-secret-value";
  const { errors, warnings } = checkEnv({ ...strong, SESSION_SECRET: secret, ADMIN_PASSWORD: secret }, "production");
  assert.ok([...errors, ...warnings].every((message) => !message.includes(secret)));
});
