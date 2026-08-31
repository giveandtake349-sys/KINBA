import type { Express, Request } from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  createPhotoPost,
  createVideo,
  getUserByOpenId,
  upsertUser,
} from "./db";
import { storagePut } from "./storage";
import {
  supabaseDisplayName,
  supabaseOpenId,
  verifySupabaseAccessToken,
} from "./supabaseAuth";
import {
  MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS,
  MAX_LONG_VIDEO_DURATION_SECONDS,
  MAX_SHORT_VIDEO_DURATION_SECONDS,
} from "./mediaValidation";

const execFileAsync = promisify(execFile);
const upload = multer({
  dest: path.join(os.tmpdir(), "kinba-video-uploads"),
  limits: { files: 1 },
});

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The media could not be published. Please try again.";
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

async function probeVideo(filePath: string) {
  const { stdout } = await execFileAsync(process.env.FFPROBE_BIN || "ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=width,height",
    "-of",
    "json",
    filePath,
  ]);
  const result = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { width?: number; height?: number }[];
  };
  const stream = result.streams?.find(item => item.width && item.height);
  const duration = Number(result.format?.duration);
  if (!Number.isFinite(duration) || !stream?.width || !stream.height)
    throw new Error("The video metadata could not be read.");
  return {
    durationSeconds: Math.ceil(duration),
    width: stream.width,
    height: stream.height,
  };
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
  app.post(
    "/api/media/video-upload",
    upload.single("video"),
    async (req, res) => {
      let temporaryPath: string | undefined;
      try {
        const user = await authenticate(req);
        if (!user) {
          res.status(401).json({ error: "Please sign in before uploading." });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: "Choose a video file." });
          return;
        }
        temporaryPath = req.file.path;
        if (req.body.kind !== "ANNOUNCEMENT") {
          res.status(400).json({ error: "Unsupported video attachment kind." });
          return;
        }
        if (!req.file.mimetype.startsWith("video/")) {
          res.status(400).json({ error: "Choose a supported video file." });
          return;
        }
        const metadata = await probeVideo(temporaryPath);
        if (
          metadata.durationSeconds > MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS
        ) {
          res.status(400).json({
            error: "Announcement videos must be 5 minutes or shorter.",
          });
          return;
        }
        const uploaded = await storagePut(
          `announcements/${user.id}/video-${Date.now()}-${req.file.originalname}`,
          await fs.readFile(temporaryPath),
          req.file.mimetype
        );
        res.status(201).json({
          url: uploaded.url,
          width: metadata.width,
          height: metadata.height,
          durationSeconds: metadata.durationSeconds,
        });
      } catch (error) {
        res.status(500).json({ error: errorMessage(error) });
      } finally {
        if (temporaryPath)
          await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
  );

  app.post("/api/photos/upload", upload.single("photo"), async (req, res) => {
    let temporaryPath: string | undefined;
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
  app.post("/api/videos/upload", upload.single("video"), async (req, res) => {
    let temporaryPath: string | undefined;
    try {
      logUploadStage("video", "received", {
        hasAuthorization: Boolean(req.headers.authorization),
        bodyKeys: Object.keys(req.body ?? {}),
        file: req.file
          ? { field: req.file.fieldname, name: req.file.originalname, type: req.file.mimetype, size: req.file.size }
          : null,
      });
      const user = await authenticate(req);
      logUploadStage("video", "authenticated", { userId: user?.id ?? null });
      if (!user) {
        res.status(401).json({ error: "Please sign in before uploading." });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "Choose a video file." });
        return;
      }
      temporaryPath = req.file.path;
      if (!req.file.mimetype.startsWith("video/")) {
        res.status(400).json({ error: "Choose a supported video file." });
        return;
      }
      const kind = req.body.kind === "SHORT" ? "SHORT" : "LONG";
      const title = String(req.body.title ?? "").trim();
      const description = String(req.body.description ?? "").trim();
      if (title.length < 3 || title.length > 180) {
        res
          .status(400)
          .json({ error: "Title must be between 3 and 180 characters." });
        return;
      }
      const metadata = await probeVideo(temporaryPath);
      const maximum =
        kind === "SHORT"
          ? MAX_SHORT_VIDEO_DURATION_SECONDS
          : MAX_LONG_VIDEO_DURATION_SECONDS;
      logUploadStage("video", "probed", { userId: user.id, kind, ...metadata });
      if (metadata.durationSeconds > maximum) {
        res.status(400).json({
          error: `Videos must be ${maximum / 60 === 1 ? "1 minute" : "30 minutes"} or shorter.`,
        });
        return;
      }
      const uploaded = await storagePut(
        `videos/${user.id}/source-${Date.now()}-${req.file.originalname}`,
        await fs.readFile(temporaryPath),
        req.file.mimetype
      );
      logUploadStage("video", "stored", { userId: user.id, key: uploaded.key });
      const sourceUrl = new URL(
        uploaded.url,
        `${req.protocol}://${req.get("host")}`
      ).toString();
      const video = await createVideo(user.id, {
        title,
        description,
        videoUrl: sourceUrl,
        thumbnailUrl: null,
        kind,
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        sources: [{ quality: "ORIGINAL", videoUrl: sourceUrl }],
      });
      logUploadStage("video", "published", { userId: user.id, videoId: video.id });
      res.status(201).json({
        videoId: video.id,
        status: "PUBLISHED",
        processingStatus: video.processingStatus,
        videoUrl: sourceUrl,
      });
    } catch (error) {
      logUploadFailure("video", req, error);
      res.status(500).json({ error: errorMessage(error) });
    } finally {
      if (temporaryPath)
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  });
}
