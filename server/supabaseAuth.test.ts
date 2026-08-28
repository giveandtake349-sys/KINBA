import { describe, expect, it, vi } from "vitest";
import { getBearerToken, supabaseDisplayName, supabaseOpenId, verifySupabaseAccessToken } from "./supabaseAuth";

function requestWithAuthorization(value?: string) {
  return { headers: value ? { authorization: value } : {} } as never;
}

describe("Supabase Auth request handling", () => {
  it("extracts only a non-empty Bearer token", () => {
    expect(getBearerToken(requestWithAuthorization("Bearer abc123"))).toBe("abc123");
    expect(getBearerToken(requestWithAuthorization("Basic abc123"))).toBeNull();
    expect(getBearerToken(requestWithAuthorization("Bearer "))).toBeNull();
  });

  it("namespaces Supabase IDs away from legacy OAuth IDs", () => {
    expect(supabaseOpenId("auth-user-1")).toBe("supabase:auth-user-1");
  });

  it("uses profile metadata or email for a display name", () => {
    expect(supabaseDisplayName({ user_metadata: { full_name: "Amina Noor" }, email: "amina@example.com" } as never)).toBe("Amina Noor");
    expect(supabaseDisplayName({ user_metadata: {}, email: "amina@example.com" } as never)).toBe("amina@example.com");
  });

  it("accepts a verified Supabase user returned by the Auth API", async () => {
    const user = { id: "auth-user-1", email: "amina@example.com", user_metadata: {} };
    const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) } } as never;
    await expect(verifySupabaseAccessToken(requestWithAuthorization("Bearer valid-token"), client)).resolves.toEqual(user);
  });
});
