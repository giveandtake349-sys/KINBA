import { useLocation } from "wouter";
import {
  segmentTextWithMentions,
  type MentionSegment,
} from "@/lib/mentionParser";

/**
 * MentionText — renders plain text with clickable @mention links.
 *
 * - Preserves original text including whitespace and punctuation
 * - Username mentions become <a> links to /@username; numeric mentions are
 *   real selected user IDs and link directly to /profile/:id.
 * - Email-style occurrences and sub-3-character handles stay plain text
 * - Uses wouter's useLocation for SPA navigation (no full page reload)
 */
export function MentionText({
  text,
  className = "",
}: {
  text: string | null | undefined;
  className?: string;
}) {
  const [, navigate] = useLocation();

  if (!text) return null;

  const segments: MentionSegment[] = segmentTextWithMentions(text);

  const handleMentionClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    username: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(/^\d+$/.test(username) ? `/profile/${username}` : `/@${username}`);
  };

  return (
    <span className={`mention-text ${className}`} data-testid="mention-text-root">
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={`text-${index}`}>{segment.content}</span>;
        }
        const href = /^\d+$/.test(segment.username ?? "")
          ? `/profile/${segment.username}`
          : `/@${segment.username}`;
        return (
          <a
            key={`mention-${index}`}
            href={href}
            onClick={event => handleMentionClick(event, segment.username!)}
            className="mention-link"
            rel="noopener noreferrer"
          >
            {segment.content}
          </a>
        );
      })}
    </span>
  );
}
