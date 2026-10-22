export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DISABLE_BACKGROUND_JOBS !== "true") {
    const { startBackgroundJobs } = await import("./lib/jobs");
    startBackgroundJobs();
  }
}
