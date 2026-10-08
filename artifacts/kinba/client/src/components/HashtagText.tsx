import { segmentTextWithHashtags, type HashtagSegment } from "@/lib/hashtagParser";
import { useLocation } from "wouter";

/**
 * HashtagText — renders plain text with clickable hashtag links.
 *
 * - Preserves original text including whitespace and punctuation
 * - Hashtags become <a> links to /tag/<normalizedTag>
 * - Display casing matches first-seen casing from the text
 * - Uses wouter's useLocation for SPA navigation (no full page reload)
 * - Accessible: links have proper href and rel attributes
 */
export function HashtagText({
  text,
  className = "",
}: {
  text: string | null | undefined;
  className?: string;
}) {
  const [, navigate] = useLocation();

  if (!text) return null;

  const segments = segmentTextWithHashtags(text);

  const handleHashtagClick = (event: React.MouseEvent<HTMLAnchorElement>, normalizedTag: string) => {
    event.preventDefault();
    event.stopPropagation();
    const href = `/tag/${encodeURIComponent(normalizedTag)}`;
    navigate(href);
  };

  return (
    <span className={`hashtag-text ${className}`} data-testid="hashtag-text-root">
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <span key={`text-${index}`}>{segment.content}</span>;
        }
        return (
          <a
            key={`tag-${index}`}
            href={`/tag/${encodeURIComponent(segment.normalized!)}`}
            onClick={(e) => handleHashtagClick(e, segment.normalized!)}
            className="hashtag-link"
            rel="noopener noreferrer"
          >
            {segment.content}
          </a>
        );
      })}
    </span>
  );
}