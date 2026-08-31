import { describe, expect, it } from "vitest";
import { resolvePostgresDatabaseUrl } from "./databaseConfig";

describe("resolvePostgresDatabaseUrl", () => {
  it("prefers the primary DATABASE_URL when both URLs are configured", () => {
    expect(resolvePostgresDatabaseUrl({
      SUPABASE_DATABASE_URL: "postgresql://supabase.example/nivo",
      DATABASE_URL: "postgresql://render.example/nivo",
    })).toBe("postgresql://render.example/nivo");
  });

  it("accepts a Supabase PostgreSQL URL as a fallback", () => {
    expect(resolvePostgresDatabaseUrl({ SUPABASE_DATABASE_URL: "postgres://supabase.example/nivo" })).toBe("postgres://supabase.example/nivo");
  });

  it("rejects missing or non-PostgreSQL database URLs", () => {
    expect(resolvePostgresDatabaseUrl({ DATABASE_URL: "mysql://example/nivo" })).toBeNull();
    expect(resolvePostgresDatabaseUrl({})).toBeNull();
  });
});
