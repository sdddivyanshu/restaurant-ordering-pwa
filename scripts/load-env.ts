// Load env for standalone scripts (seed, QR printing). Existing env vars always win.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });
