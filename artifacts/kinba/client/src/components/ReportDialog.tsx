import { useEffect, useState, type FormEvent } from "react";
import { Flag, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { getTrpcCode } from "@/pages/HypeRooms";
import "./kinbaModern.css";

const REASON_MAX = 120;
const DETAILS_MAX = 2000;

export type ReportTargetType =
  | "hype_room"
  | "hype_room_message"
  | "drop"
  | "user";

export function ReportDialog({
  open,
  onClose,
  targetType,
  targetId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: number | null;
  title?: string;
}) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const createReport = trpc.reports.create.useMutation();

  useEffect(() => {
    if (!open) {
      setReason("");
      setDetails("");
      createReport.reset();
    }
  }, [open, createReport]);

  if (!open || targetId == null) return null;

  const dialogTitle = title ?? "Report content";
  const trimmedReason = reason.trim();
  const trimmedDetails = details.trim();
  const canSubmit = trimmedReason.length > 0 && !createReport.isPending;

  const close = () => {
    if (createReport.isPending) return;
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || targetId == null) return;
    try {
      await createReport.mutateAsync({
        targetType,
        targetId,
        reason: trimmedReason,
        details: trimmedDetails.length > 0 ? trimmedDetails : null,
      });
      toast.success("Report submitted. Thank you for the heads-up.");
      onClose();
    } catch (error) {
      if (getTrpcCode(error) === "PRECONDITION_FAILED") {
        toast.error("Reporting is currently unavailable.");
        return;
      }
      toast.error(
        error instanceof Error ? error.message : "Could not submit this report."
      );
    }
  };

  return (
    <div className="action-modal-layer" role="presentation">
      <button
        type="button"
        className="action-modal-backdrop"
        aria-label={`Close ${dialogTitle}`}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
      />
      <section
        className="action-modal report-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
      >
        <div className="action-modal-head">
          <h2>
            <Flag size={18} aria-hidden="true" /> {dialogTitle}
          </h2>
          <button
            type="button"
            aria-label={`Close ${dialogTitle}`}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              close();
            }}
          >
            <X size={20} />
          </button>
        </div>
        <form className="modal-form report-dialog-form" onSubmit={handleSubmit}>
          <p className="report-dialog-hint">
            Tell us what looks wrong. Reports are reviewed by moderators.
          </p>
          <label htmlFor="report-reason">
            Reason <span className="report-dialog-req">(required)</span>
            <input
              id="report-reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              maxLength={REASON_MAX}
              required
              placeholder="Brief reason (1–120 characters)"
              autoComplete="off"
            />
            <span className="report-dialog-count">
              {reason.trim().length}/{REASON_MAX}
            </span>
          </label>
          <label htmlFor="report-details">
            Details <span className="report-dialog-optional">(optional)</span>
            <textarea
              id="report-details"
              value={details}
              onChange={event => setDetails(event.target.value)}
              maxLength={DETAILS_MAX}
              rows={4}
              placeholder="Add context (max 2000 characters)"
            />
            <span className="report-dialog-count">
              {details.trim().length}/{DETAILS_MAX}
            </span>
          </label>
          <div className="report-dialog-actions">
            <button
              type="button"
              className="muted-btn"
              onClick={close}
              disabled={createReport.isPending}
            >
              Cancel
            </button>
            <button type="submit" className="primary-btn" disabled={!canSubmit}>
              {createReport.isPending ? "Submitting…" : "Submit report"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
