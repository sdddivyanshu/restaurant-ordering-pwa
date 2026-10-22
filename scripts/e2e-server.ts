// Starts an isolated production server for Playwright: points at E2E_DATABASE_URL, applies
// migrations (non-destructive deploy), loads the demo seed (clears that e2e database only),
// builds if needed and runs `next start`.
import "./load-env";
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";

const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error("E2E_DATABASE_URL is not set (see .env.example)");
if (url === process.env.DATABASE_URL) throw new Error("E2E_DATABASE_URL must differ from DATABASE_URL");
const port = process.env.E2E_PORT ?? "3100";
const env = { ...process.env, DATABASE_URL: url, APP_BASE_URL: `http://localhost:${port}`, PORT: port,
  // Disposable e2e environment: explicitly allow the seeded demo staff accounts under `next start`.
  ALLOW_DEMO_ACCOUNTS: "true" };

execSync("npx prisma migrate deploy", { stdio: "inherit", env });
execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });
if (!existsSync(".next/BUILD_ID") || process.env.E2E_REBUILD === "true") execSync("npm run build", { stdio: "inherit", env });

const child = spawn("npx", ["next", "start", "-p", port], { stdio: "inherit", env, shell: true });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
