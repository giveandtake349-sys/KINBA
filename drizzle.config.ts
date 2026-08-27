import { defineConfig } from "drizzle-kit";

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) {
  throw new Error("SUPABASE_DATABASE_URL is required to run PostgreSQL Drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: connectionString },
});
