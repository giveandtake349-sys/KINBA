/**
 * Shared request authentication used by the media upload routes.
 *
 * Extracted from `videoUploadRoute.ts` so that unrelated modules (the DM
 * attachment upload route) can authenticate without pulling the whole media
 * publishing route — and its multer/express typings — into their module graph.
 */
import type { Request } from "express";
import { getUserByOpenId, upsertUser } from "./db";
import {
  supabaseDisplayName,
  supabaseOpenId,
  verifySupabaseAccessToken,
} from "./supabaseAuth";

export async function authenticate(request: Request) {
  const supabaseUser = await verifySupabaseAccessToken(request);
  if (!supabaseUser) return null;
  const openId = supabaseOpenId(supabaseUser.id);
  await upsertUser({
    openId,
    name: supabaseDisplayName(supabaseUser),
    email: supabaseUser.email ?? null,
    loginMethod: "supabase",
    lastSignedIn: new Date(),
  });
  return getUserByOpenId(openId);
}
