import { describe, expect, it } from "vitest";
import { resolvePostgresDatabaseUrl } from "./databaseConfig";

describe("resolvePostgresDatabaseUrl", () => {
  it("prefers the primary DATABASE_URL when both URLs are configured", () => {
    expect(resolvePostgresDatabaseUrl({
      SUPABASE_DATABASE_URL: "postgresql://supabase.example/kinba",
      DATABASE_URL: "postgresql://render.example/kinba",
    })).toBe("postgresql://render.example/kinba");
  });

  it("accepts a Supabase PostgreSQL URL as a fallback", () => {
    expect(resolvePostgresDatabaseUrl({ SUPABASE_DATABASE_URL: "postgres://supabase.example/kinba" })).toBe("postgres://supabase.example/kinba");
  });

  it("rejects missing or non-PostgreSQL database URLs", () => {
    expect(resolvePostgresDatabaseUrl({ DATABASE_URL: "mysql://example/kinba" })).toBeNull();
    expect(resolvePostgresDatabaseUrl({})).toBeNull();
  });
});
