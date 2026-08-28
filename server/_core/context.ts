import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getUserByOpenId, upsertUser } from "../db";
import { supabaseDisplayName, supabaseOpenId, verifySupabaseAccessToken } from "../supabaseAuth";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

type ContextDependencies = {
  verifyAccessToken: typeof verifySupabaseAccessToken;
  saveUser: typeof upsertUser;
  findUser: typeof getUserByOpenId;
};

const defaultDependencies: ContextDependencies = {
  verifyAccessToken: verifySupabaseAccessToken,
  saveUser: upsertUser,
  findUser: getUserByOpenId,
};

export async function createContext(
  opts: CreateExpressContextOptions,
  dependencies: ContextDependencies = defaultDependencies,
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    const supabaseUser = await dependencies.verifyAccessToken(opts.req);
    if (supabaseUser) {
      const openId = supabaseOpenId(supabaseUser.id);
      await dependencies.saveUser({
        openId,
        name: supabaseDisplayName(supabaseUser),
        email: supabaseUser.email ?? null,
        loginMethod: "supabase",
        lastSignedIn: new Date(),
      });
      user = (await dependencies.findUser(openId)) ?? null;
    }
  } catch (error) {
    console.warn("[Supabase Auth] Request authentication failed:", error instanceof Error ? error.message : error);
    user = null;
  }

  return { req: opts.req, res: opts.res, user };
}

export type { SupabaseUser };
