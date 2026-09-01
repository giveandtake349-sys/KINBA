import type { Express, NextFunction, Request, Response } from "express";
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
  getVideoThumbnailSource,
  setVideoThumbnail,
  upsertUser,
} from "./db";
import { storageDownload, storagePut } from "./storage";
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

async function createVideoThumbnail(videoPath: string, thumbnailPath: string) {
  await execFileAsync(process.env.FFMPEG_BIN || "ffmpeg", [
    "-y",
    "-ss",
    "0.2",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=640:-2",
    "-q:v",
    "2",
    thumbnailPath,
  ], { maxBuffer: 8 * 1024 * 1024 });
  const thumbnail = await fs.readFile(thumbnailPath);
  if (!thumbnail.length) throw new Error("The video thumbnail is empty.");
  return thumbnail;
}

async function probeVideo(filePath: string) {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(process.env.FFPROBE_BIN || "ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=width,height",
    "-of",
    "json",
    filePath,
    ]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Video metadata validation is unavailable because ffprobe is not installed in the Render runtime.");
    }
    throw new Error("ffprobe could not read this video: " + errorMessage(error));
  }
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
  app.get("/api/videos/:videoId/thumbnail", async (req, res) => {
    const videoId = Number(req.params.videoId);
    if (!Number.isInteger(videoId) || videoId < 1) {
      res.status(400).send("Invalid video ID");
      return;
    }
    let sourcePath: string | undefined;
    let thumbnailPath: string | undefined;
    try {
      const video = await getVideoThumbnailSource(videoId);
      if (!video || video.mediaType !== "VIDEO") {
        res.status(404).send("Video not found");
        return;
      }
      if (video.thumbnailUrl) {
        res.redirect(307, video.thumbnailUrl);
        return;
      }
      const source = await storageDownload(video.videoUrl);
      sourcePath = path.join(os.tmpdir(), `kinba-repair-source-${videoId}-${Date.now()}`);
      thumbnailPath = path.join(os.tmpdir(), `kinba-repair-thumb-${videoId}-${Date.now()}.jpg`);
      await fs.writeFile(sourcePath, source);
      const thumbnail = await createVideoThumbnail(sourcePath, thumbnailPath);
      const uploaded = await storagePut(`videos/repaired/thumbnail-${videoId}.jpg`, thumbnail, "image/jpeg");
      await setVideoThumbnail(videoId, uploaded.url);
      res.set({ "Cache-Control": "public, max-age=86400", "Content-Type": "image/jpeg" });
      res.send(thumbnail);
    } catch (error) {
      console.error(`[ThumbnailRepair] Video ${videoId} failed:`, error);
      res.status(404).send("Video thumbnail unavailable");
    } finally {
      if (sourcePath) await fs.rm(sourcePath, { force: true }).catch(() => undefined);
      if (thumbnailPath) await fs.rm(thumbnailPath, { force: true }).catch(() => undefined);
    }
  });

  app.post(
    "/api/media/video-upload",
    uploadSingle("video"),
    async (req, res) => {
      let temporaryPath: string | undefined;
      let temporaryThumbnailPath: string | undefined;
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
        temporaryThumbnailPath = path.join(os.tmpdir(), `kinba-thumbnail-${Date.now()}.jpg`);
        const thumbnail = await createVideoThumbnail(temporaryPath, temporaryThumbnailPath);
        const objectId = `${Date.now()}-${req.file.originalname}`;
        const uploaded = await storagePut(
          `announcements/${user.id}/video-${objectId}`,
          await fs.readFile(temporaryPath),
          req.file.mimetype
        );
        const uploadedThumbnail = await storagePut(
          `announcements/${user.id}/thumbnail-${objectId}.jpg`,
          thumbnail,
          "image/jpeg"
        );
        res.status(201).json({
          url: uploaded.url,
          videoUrl: uploaded.url,
          mediaType: "VIDEO",
          thumbnailUrl: uploadedThumbnail.url,
          width: metadata.width,
          height: metadata.height,
          durationSeconds: metadata.durationSeconds,
        });
      } catch (error) {
        res.status(500).json({ error: errorMessage(error) });
      } finally {
        if (temporaryPath)
          await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
        if (temporaryThumbnailPath)
          await fs.rm(temporaryThumbnailPath, { force: true }).catch(() => undefined);
      }
    }
  );

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
  app.post("/api/videos/upload", uploadSingle("video"), async (req, res) => {
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
      temporaryThumbnailPath = path.join(os.tmpdir(), `kinba-thumbnail-${Date.now()}.jpg`);
      const thumbnail = await createVideoThumbnail(temporaryPath, temporaryThumbnailPath);
      const objectId = `${Date.now()}-${req.file.originalname}`;
      const uploaded = await storagePut(
        `videos/${user.id}/source-${objectId}`,
        await fs.readFile(temporaryPath),
        req.file.mimetype
      );
      logUploadStage("video", "stored", { userId: user.id, key: uploaded.key });
      const uploadedThumbnail = await storagePut(
        `videos/${user.id}/thumbnail-${objectId}.jpg`,
        thumbnail,
        "image/jpeg"
      );
      const sourceUrl = new URL(
        uploaded.url,
        `${req.protocol}://${req.get("host")}`
      ).toString();
      const video = await createVideo(user.id, {
        title,
        description,
        videoUrl: sourceUrl,
        thumbnailUrl: uploadedThumbnail.url,
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
        thumbnailUrl: uploadedThumbnail.url,
      });
    } catch (error) {
      logUploadFailure("video", req, error);
      res.status(500).json({ error: errorMessage(error) });
    } finally {
      if (temporaryPath)
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      if (temporaryThumbnailPath)
        await fs.rm(temporaryThumbnailPath, { force: true }).catch(() => undefined);
    }
  });
}
