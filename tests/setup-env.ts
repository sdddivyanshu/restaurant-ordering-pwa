// Runs in every test worker before test files are imported.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is not set. Copy .env.example to .env.local (see README).");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// Tests drive the outbox dispatcher explicitly for deterministic assertions.
process.env.OUTBOX_AUTO_KICK = "false";
process.env.OTP_MODE = "dev";
process.env.APP_BASE_URL = "http://localhost:3000";
