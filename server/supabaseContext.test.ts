import { describe, expect, it, vi } from "vitest";
import { createContext } from "./_core/context";
import { appRouter } from "./routers";

const user = {
  id: 42,
  openId: "supabase:auth-user-42",
  email: "member@example.com",
  name: "Member Example",
  loginMethod: "supabase",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
} as const;

describe("Supabase-authenticated tRPC context", () => {
  it("maps the verified Supabase identity before a protected procedure runs", async () => {
    const saveUser = vi.fn().mockResolvedValue(undefined);
    const findUser = vi.fn().mockResolvedValue(user);
    const verifyAccessToken = vi.fn().mockResolvedValue({
      id: "auth-user-42",
      email: "member@example.com",
      user_metadata: { full_name: "Member Example" },
    });
    const context = await createContext(
      {
        req: { headers: { authorization: "Bearer valid-token" } },
        res: {},
      } as never,
      { verifyAccessToken, saveUser, findUser }
    );
    expect(context.user).toEqual(user);
    expect(saveUser).toHaveBeenCalledWith(
      expect.objectContaining({
        openId: "supabase:auth-user-42",
        email: "member@example.com",
        name: "Member Example",
        loginMethod: "supabase",
      })
    );
    expect(await appRouter.createCaller(context).auth.me()).toEqual(user);
  });

  it("keeps anonymous requests outside protected profile procedures", async () => {
    const context = await createContext(
      { req: { headers: {} }, res: {} } as never,
      {
        verifyAccessToken: vi.fn().mockResolvedValue(null),
        saveUser: vi.fn(),
        findUser: vi.fn(),
      }
    );
    await expect(
      appRouter.createCaller(context).profile.me()
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
