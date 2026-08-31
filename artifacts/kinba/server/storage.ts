import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

export const MEDIA_BUCKET = "signal-media";
const signedUrlLifetimeSeconds = 60 * 60;

let r2Client: S3Client | null = null;

function getR2Config() {
  const config = {
    endpoint: ENV.r2Endpoint,
    accessKeyId: ENV.r2AccessKeyId,
    secretAccessKey: ENV.r2SecretAccessKey,
    bucket: ENV.r2BucketName || "kinba-media",
    publicBaseUrl: ENV.r2PublicBaseUrl,
  };
  if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error(
      "R2 storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME on Render."
    );
  }
  return config;
}

function getR2Client() {
  if (!r2Client) {
    const config = getR2Config();
    r2Client = new S3Client({
      endpoint: config.endpoint,
      region: "auto",
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return r2Client;
}

function normalizeKey(relKey: string) {
  const key = relKey
    .replace(/\\/g, "/")
    .split("/")
    .filter(part => part && part !== "." && part !== "..")
    .map(part => part.replace(/[^a-zA-Z0-9._-]/g, "-") || "file")
    .join("/");
  if (!key) throw new Error("Storage object path cannot be empty.");
  return key;
}

function appendHashSuffix(relKey: string) {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

function publicUrl(key: string) {
  const baseUrl = getR2Config().publicBaseUrl;
  if (!baseUrl) {
    throw new Error(
      "R2 public playback is not configured. Set R2_PUBLIC_BASE_URL for stable HLS URLs."
    );
  }
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return `${normalizedBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function asBody(data: Buffer | Uint8Array | string) {
  return typeof data === "string"
    ? Buffer.from(data, "utf8")
    : Buffer.from(data);
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const config = getR2Config();
  const key = appendHashSuffix(normalizeKey(relKey));
  try {
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: asBody(data),
        ContentType: contentType,
        CacheControl: "public, max-age=3600",
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown R2 error";
    throw new Error(`Cloudflare R2 upload failed: ${message}`);
  }
  return { key, url: publicUrl(key) };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const url = ENV.r2PublicBaseUrl
    ? publicUrl(key)
    : await storageGetSignedUrl(key);
  return { key, url };
}

function keyFromStoredUrl(sourceUrl: string) {
  const config = getR2Config();
  try {
    const parsed = new URL(sourceUrl);
    const pathname = decodeURIComponent(parsed.pathname);

    if (config.publicBaseUrl) {
      const publicBase = new URL(
        `${config.publicBaseUrl.replace(/\/+$/, "")}/`
      );
      if (parsed.origin === publicBase.origin) {
        const basePath = publicBase.pathname.replace(/\/+$/, "");
        if (pathname.startsWith(`${basePath}/`)) {
          return normalizeKey(pathname.slice(basePath.length + 1));
        }
      }
    }

    // Older records may contain an S3/R2 endpoint URL. Because the client is
    // configured with forcePathStyle, those URLs use /<bucket>/<key>.
    const endpoint = new URL(config.endpoint);
    const bucketPrefix = `/${encodeURIComponent(config.bucket)}/`;
    if (parsed.origin === endpoint.origin && pathname.startsWith(bucketPrefix)) {
      return normalizeKey(pathname.slice(bucketPrefix.length));
    }
  } catch {
    // Non-URL values are handled by the normal public fetch fallback below.
  }
  return null;
}

export async function storageDownload(sourceUrl: string): Promise<Buffer> {
  const config = getR2Config();
  const key = keyFromStoredUrl(sourceUrl);
  if (key) {
    try {
      const object = await getR2Client().send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key })
      );
      if (!object.Body) throw new Error("R2 returned an empty source object.");
      return Buffer.from(await object.Body.transformToByteArray());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown R2 error";
      throw new Error(`Cloudflare R2 source download failed: ${message}`);
    }
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Source video download failed (${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const config = getR2Config();
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: config.bucket, Key: normalizeKey(relKey) }),
    { expiresIn: signedUrlLifetimeSeconds }
  );
}
