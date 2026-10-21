import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_MIGRATION_URL?.trim();
if (!url) throw new Error("DATABASE_MIGRATION_URL is required to run migrations.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/platform-server/src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
