// Runs once when the Next.js server starts, before any page renders.
export async function register(): Promise<void> {
  // Node before 26 has no Temporal, which Hapio Calendar needs when it renders on the server.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("temporal-polyfill/global")
  }
}
