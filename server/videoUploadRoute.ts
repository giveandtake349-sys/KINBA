import type { Express, Request } from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createVideo, getUserByOpenId, upsertUser } from "./db";
import { storagePut } from "./storage";
import { queueVideoTranscode } from "./hlsProcessor";
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
  return error instanceof Error ? error.message : "Upload failed.";
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

  app.post("/api/videos/upload", upload.single("video"), async (req, res) => {
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
      queueVideoTranscode(video.id, sourceUrl);
      res.status(202).json({ videoId: video.id, status: "PROCESSING" });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    } finally {
      if (temporaryPath)
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  });
}
