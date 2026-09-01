CREATE TABLE IF NOT EXISTS public.video_bookmarks (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "videoId" integer NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  "userId" integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS video_bookmarks_pair_unique ON public.video_bookmarks ("videoId", "userId");
CREATE INDEX IF NOT EXISTS video_bookmarks_video_idx ON public.video_bookmarks ("videoId");
CREATE INDEX IF NOT EXISTS video_bookmarks_user_idx ON public.video_bookmarks ("userId");
