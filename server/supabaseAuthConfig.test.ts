import { describe, expect, it } from "vitest";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const testIfConfigured = supabaseUrl && supabaseAnonKey ? it : it.skip;

describe("Supabase Auth configuration", () => {
  testIfConfigured("accepts the configured anon key at the Auth settings endpoint", async () => {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey!, Authorization: `Bearer ${supabaseAnonKey}` },
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { external?: Record<string, unknown> };
    expect(body).toHaveProperty("external");
  }, 15_000);
});
