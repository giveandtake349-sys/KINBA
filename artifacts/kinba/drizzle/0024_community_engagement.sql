CREATE TABLE IF NOT EXISTS public.community_reactions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "announcementId" integer NOT NULL REFERENCES public.community_announcements(id) ON DELETE CASCADE,
  "userId" integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS community_reactions_pair_unique ON public.community_reactions ("announcementId", "userId");
CREATE INDEX IF NOT EXISTS community_reactions_announcement_idx ON public.community_reactions ("announcementId");
CREATE INDEX IF NOT EXISTS community_reactions_user_idx ON public.community_reactions ("userId");

CREATE TABLE IF NOT EXISTS public.community_bookmarks (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "announcementId" integer NOT NULL REFERENCES public.community_announcements(id) ON DELETE CASCADE,
  "userId" integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS community_bookmarks_pair_unique ON public.community_bookmarks ("announcementId", "userId");
CREATE INDEX IF NOT EXISTS community_bookmarks_announcement_idx ON public.community_bookmarks ("announcementId");
CREATE INDEX IF NOT EXISTS community_bookmarks_user_idx ON public.community_bookmarks ("userId");