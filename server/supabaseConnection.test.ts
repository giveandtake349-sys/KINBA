import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.SUPABASE_DATABASE_URL;
const client = databaseUrl ? new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } }) : null;

afterAll(async () => {
  await client?.end();
});

describe("Supabase PostgreSQL connection", () => {
  it.skipIf(!databaseUrl)("connects with the configured server-side URL", async () => {
    expect(databaseUrl).toMatch(/^postgresql:\/\//);
    expect(client).not.toBeNull();
    await client!.connect();
    const result = await client!.query("select 1 as connected");
    expect(result.rows[0]?.connected).toBe(1);

    const tables = await client!.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
      [["users", "profiles", "signals", "connections", "messages", "blocks", "reports"]],
    );
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      "blocks", "connections", "messages", "profiles", "reports", "signals", "users",
    ]);
  }, 15_000);
});
