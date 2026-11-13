// Next.js calls register() once when the server starts (not during `next build`).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertEnv } = await import("@/lib/env");
  try {
    assertEnv();
  } catch (error) {
    // Next.js only logs a throwing instrumentation hook and keeps the process alive, so exit
    // explicitly: the host then sees a failed start instead of a running but broken server.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
