import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Load .env.local first (developer overrides), then .env. Existing process env always wins,
// which lets test scripts point Prisma at the test database.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
