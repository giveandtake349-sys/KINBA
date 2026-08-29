INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signal-media',
  'signal-media',
  true,
  2147483648,
  ARRAY[
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg',
    'video/*', 'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg',
    'video/mpeg', 'video/x-matroska', 'video/x-msvideo', 'video/3gpp', 'video/x-flv',
    'video/mp2t', 'application/vnd.apple.mpegurl'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
