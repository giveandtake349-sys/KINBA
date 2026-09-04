import type { Express } from "express";
import { deleteComment, toggleCommentLike } from "./db";
import { authenticate } from "./videoUploadRoute";

function positiveId(value: string | undefined) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function messageFor(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The comment operation could not be completed.";
}

export function registerCommentRoutes(app: Express) {
  app.delete("/api/comments/:id", async (req, res) => {
    const commentId = positiveId(req.params.id);
    if (!commentId) {
      res.status(400).json({ error: "Invalid comment id." });
      return;
    }
    try {
      const user = await authenticate(req);
      if (!user) {
        res.status(401).json({ error: "Please sign in before deleting a comment." });
        return;
      }
      res.json(await deleteComment(commentId, user.id));
    } catch (error) {
      console.error("[Comments] delete failed", { commentId, error });
      const message = messageFor(error);
      const status = message.includes("authorized") ? 403 : message.includes("not found") ? 404 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/comments/:id/like", async (req, res) => {
    const commentId = positiveId(req.params.id);
    if (!commentId) {
      res.status(400).json({ error: "Invalid comment id." });
      return;
    }
    try {
      const user = await authenticate(req);
      if (!user) {
        res.status(401).json({ error: "Please sign in before liking a comment." });
        return;
      }
      res.json(await toggleCommentLike(commentId, user.id));
    } catch (error) {
      console.error("[Comments] like failed", { commentId, error });
      const message = messageFor(error);
      res.status(message.includes("not found") ? 404 : 500).json({ error: message });
    }
  });
}
