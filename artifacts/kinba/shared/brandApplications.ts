/** Allowed MIME types for brand verification documents. */
export const BRAND_DOC_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** Maximum size of one brand verification document, in decimal bytes. */
export const MAX_BRAND_DOC_BYTES = 10_000_000;
export const MAX_BRAND_DOC_SIZE_LABEL = "10 MB";
