import { execSync } from "node:child_process";
import { config } from "dotenv";

/**
 * Prepare the dedicated test database once per `vitest run`: apply migrations (non-destructive
 * `migrate deploy`) and load the demo seed, which clears that database's rows first.
 * Refuses to touch the development database.
 */
export default function setup() {
  const filters = process.argv.slice(2).filter((a) => a !== "run" && !a.startsWith("-") && !a.endsWith("vitest.mjs"));
  const onlyUnit = filters.length > 0 && filters.every((a) => a.replaceAll("\\", "/").includes("tests/unit"));
  if (onlyUnit) return;
  config({ path: ".env.local", quiet: true });
  config({ quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL — the test seed clears it.");
  if (!/_test\b|test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'.");
  const env = { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });
}
