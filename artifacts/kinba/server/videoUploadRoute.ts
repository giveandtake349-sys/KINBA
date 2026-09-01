import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createPhotoPost,
  createVideo,
  getUserByOpenId,
  upsertUser,
} from "./db";
import { storageCreateUploadUrl, storagePut } from "./storage";
import {
  supabaseDisplayName,
  supabaseOpenId,
  verifySupabaseAccessToken,
} from "./supabaseAuth";
import {
  MAX_LONG_VIDEO_DURATION_SECONDS,
  MAX_SHORT_VIDEO_DURATION_SECONDS,
} from "./mediaValidation";

const upload = multer({
  dest: path.join(os.tmpdir(), "kinba-video-uploads"),
  limits: { files: 1, fileSize: 500 * 1024 * 1024 },
});

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The media could not be published. Please try again.";
}

function uploadSingle(field: "video" | "photo") {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(field)(req, res, error => {
      if (!error) { next(); return; }
      const message =
        error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
          ? "The file is too large. Maximum upload size is 500MB."
          : error instanceof multer.MulterError
            ? "Upload form error: " + error.code + "."
            : errorMessage(error);
      console.error("[MediaUpload] " + field + " multipart failure", {
        message,
        code: error instanceof multer.MulterError ? error.code : undefined,
      });
      res.status(400).json({ error: message });
    });
  };
}


function logUploadFailure(route: string, request: Request, error: unknown) {
  const detail = error instanceof Error ? error : new Error(String(error));
  console.error(`[MediaUpload] ${route} failed`, {
    method: request.method,
    url: request.url,
    message: detail.message,
    stack: detail.stack,
  });
}

function logUploadStage(route: string, stage: string, details: Record<string, unknown>) {
  console.info(`[MediaUpload] ${route} ${stage}`, details);
}



async function authenticate(request: Request) {
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

export function registerVideoUploadRoute(app: Express) {
  // Video bytes never pass through Node. The browser uploads directly to R2
  // with this short-lived signed URL, then posts only metadata here.
  app.post("/api/videos/upload-url", async (req, res) => {
    try {
      const user = await authenticate(req);
      if (!user) {
        res.status(401).json({ error: "Please sign in before uploading." });
        return;
      }
      const contentType = String(req.body?.contentType ?? "");
      const mediaRole = req.body?.mediaRole === "thumbnail" ? "thumbnail" : "source";
      const kind = req.body?.kind === "SHORT" ? "SHORT" : "LONG";
      const validType = mediaRole === "thumbnail"
        ? ["image/jpeg", "image/png", "image/webp"].includes(contentType)
        : contentType.startsWith("video/");
      if (!validType) {
        res.status(400).json({ error: "Choose a supported media file." });
        return;
      }
      const upload = await storageCreateUploadUrl(
        `videos/${user.id}/${mediaRole}-${Date.now()}`,
        contentType
      );
      res.json({ ...upload, kind });
    } catch (error) {
      logUploadFailure("video-upload-url", req, error);
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  app.post("/api/videos/complete", async (req, res) => {
    try {
      const user = await authenticate(req);
      if (!user) {
        res.status(401).json({ error: "Please sign in before uploading." });
        return;
      }
      const body = req.body ?? {};
      const title = String(body.title ?? "").trim();
      const description = String(body.description ?? "").trim();
      const videoUrl = String(body.videoUrl ?? "").trim();
      const thumbnailUrl = String(body.thumbnailUrl ?? "").trim() || null;
      const kind = body.kind === "SHORT" ? "SHORT" : "LONG";
      const durationSeconds = Number(body.durationSeconds);
      const width = Number(body.width);
      const height = Number(body.height);
      const maximum = kind === "SHORT" ? MAX_SHORT_VIDEO_DURATION_SECONDS : MAX_LONG_VIDEO_DURATION_SECONDS;
      if (title.length < 3 || title.length > 180 || !videoUrl || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > maximum || !Number.isInteger(width) || !Number.isInteger(height)) {
        res.status(400).json({ error: "The video metadata is invalid." });
        return;
      }
      const video = await createVideo(user.id, {
        title,
        description,
        videoUrl,
        thumbnailUrl,
        kind,
        durationSeconds: Math.ceil(durationSeconds),
        width,
        height,
        sources: [{ quality: "ORIGINAL", videoUrl }],
      });
      res.status(201).json({ videoId: video.id, status: "PUBLISHED", videoUrl, thumbnailUrl });
    } catch (error) {
      logUploadFailure("video-complete", req, error);
      res.status(500).json({ error: errorMessage(error) });
    }
  });


  app.post("/api/photos/upload", uploadSingle("photo"), async (req, res) => {
    let temporaryPath: string | undefined;
    let temporaryThumbnailPath: string | undefined;
    try {
      logUploadStage("photo", "received", {
        hasAuthorization: Boolean(req.headers.authorization),
        bodyKeys: Object.keys(req.body ?? {}),
        file: req.file
          ? { field: req.file.fieldname, name: req.file.originalname, type: req.file.mimetype, size: req.file.size }
          : null,
      });
      const user = await authenticate(req);
      logUploadStage("photo", "authenticated", { userId: user?.id ?? null });
      if (!user) {
        res.status(401).json({ error: "Please sign in before uploading." });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "Choose an image file." });
        return;
      }
      temporaryPath = req.file.path;
      if (!["image/jpeg", "image/png", "image/webp"].includes(req.file.mimetype)) {
        res.status(400).json({ error: "Choose a JPG, PNG, or WEBP image." });
        return;
      }
      if (req.file.size > 5 * 1024 * 1024) {
        res.status(400).json({ error: "Images must be 5MB or smaller." });
        return;
      }
      const title = String(req.body.title ?? "").trim();
      const description = String(req.body.description ?? "").trim();
      const width = Number(req.body.width);
      const height = Number(req.body.height);
      if (title.length < 3 || title.length > 180) {
        res.status(400).json({ error: "Title must be between 3 and 180 characters." });
        return;
      }
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        res.status(400).json({ error: "The image dimensions could not be read." });
        return;
      }
      logUploadStage("photo", "validated", { userId: user.id, titleLength: title.length, width, height });
      const uploaded = await storagePut(
        `photos/${user.id}/photo-${Date.now()}-${req.file.originalname}`,
        await fs.readFile(temporaryPath),
        req.file.mimetype
      );
      logUploadStage("photo", "stored", { userId: user.id, key: uploaded.key });
      const post = await createPhotoPost(user.id, {
        title,
        description,
        imageUrl: uploaded.url,
        width,
        height,
      });
      logUploadStage("photo", "published", { userId: user.id, postId: post.id });
      res.status(201).json({
        postId: post.id,
        mediaType: "IMAGE",
        status: "PUBLISHED",
        imageUrl: uploaded.url,
      });
        } catch (error) {
      logUploadFailure("photo", req, error);
      res.status(500).json({ error: errorMessage(error) });
    } finally {
      if (temporaryPath)
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  });
}
