/**
 * The single caption shown for a post.
 *
 * The unified composer publishes an image/video caption into the post's
 * `description` while `title` stays a display headline (the server back-fills
 * it with "Untitled photo"/"Untitled video" when the caller sends none), so a
 * non-empty description is always the user's words and has to win. `title` is
 * only the fallback for rows that carry no caption — e.g. profile photos or a
 * shared photo published without one.
 */
export function postCaption(
  title: string | null | undefined,
  description: string | null | undefined
): string {
  const caption = description?.trim();
  if (caption) return caption;
  return title?.trim() ?? "";
}
