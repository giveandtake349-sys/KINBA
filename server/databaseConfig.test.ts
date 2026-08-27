import { describe, expect, it } from "vitest";
import { resolvePostgresDatabaseUrl } from "./databaseConfig";

describe("resolvePostgresDatabaseUrl", () => {
  it("prefers the configured Supabase PostgreSQL URL", () => {
    expect(resolvePostgresDatabaseUrl({
      SUPABASE_DATABASE_URL: "postgresql://supabase.example/nivo",
      DATABASE_URL: "postgresql://render.example/nivo",
    })).toBe("postgresql://supabase.example/nivo");
  });

  it("accepts a conventional PostgreSQL DATABASE_URL fallback for Render", () => {
    expect(resolvePostgresDatabaseUrl({ DATABASE_URL: "postgres://render.example/nivo" })).toBe("postgres://render.example/nivo");
  });

  it("rejects missing or non-PostgreSQL database URLs", () => {
    expect(resolvePostgresDatabaseUrl({ DATABASE_URL: "mysql://example/nivo" })).toBeNull();
    expect(resolvePostgresDatabaseUrl({})).toBeNull();
  });
});
