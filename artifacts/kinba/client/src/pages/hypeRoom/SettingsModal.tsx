import { useState, type FormEvent } from "react";
import { Settings, X } from "lucide-react";

type RoomSettingsValues = {
  title: string;
  topic: string;
  description: string;
  visibility: "public" | "link_only";
};

/**
 * Premium-feeling room settings sheet — only title/topic/description/
 * visibility (matches server updateSettings). Lifecycle/host stay server-owned.
 */
export function SettingsModal({
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  initial: RoomSettingsValues;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: RoomSettingsValues) => Promise<void> | void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [topic, setTopic] = useState(initial.topic);
  const [description, setDescription] = useState(initial.description);
  const [visibility, setVisibility] = useState(initial.visibility);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      title: title.trim(),
      topic: topic.trim(),
      description: description.trim(),
      visibility,
    });
  };

  return (
    <div className="action-modal-layer" role="presentation">
      <button
        type="button"
        className="action-modal-backdrop"
        aria-label="Close room settings"
        onClick={onClose}
      />
      <section
        className="action-modal report-dialog hype-room-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Room settings"
      >
        <div className="action-modal-head">
          <h2>
            <Settings size={18} aria-hidden="true" /> Room settings
          </h2>
          <button type="button" aria-label="Close room settings" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form
          className="modal-form report-dialog-form"
          onSubmit={event => void handleSubmit(event)}
        >
          <p className="report-dialog-hint">
            Title, topic, description, and visibility only. Lifecycle and host
            cannot change here.
          </p>
          <label htmlFor="hype-settings-title">
            Title <span className="report-dialog-req">(required)</span>
            <input
              id="hype-settings-title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              minLength={3}
              maxLength={180}
              required
              autoComplete="off"
              placeholder="Room title (3–180 characters)"
            />
          </label>
          <label htmlFor="hype-settings-topic">
            Topic <span className="report-dialog-optional">(optional)</span>
            <input
              id="hype-settings-topic"
              value={topic}
              onChange={event => setTopic(event.target.value)}
              maxLength={120}
              autoComplete="off"
              placeholder="Topic tag (max 120 characters)"
            />
          </label>
          <label htmlFor="hype-settings-description">
            Description{" "}
            <span className="report-dialog-optional">(optional)</span>
            <textarea
              id="hype-settings-description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Room description (max 2000 characters)"
            />
          </label>
          <label htmlFor="hype-settings-visibility">
            Visibility
            <select
              id="hype-settings-visibility"
              value={visibility}
              onChange={event =>
                setVisibility(event.target.value as "public" | "link_only")
              }
            >
              <option value="public">Public</option>
              <option value="link_only">Link only</option>
            </select>
          </label>
          <div className="report-dialog-actions">
            <button
              type="button"
              className="muted-btn"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-btn"
              disabled={saving || title.trim().length < 3}
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
