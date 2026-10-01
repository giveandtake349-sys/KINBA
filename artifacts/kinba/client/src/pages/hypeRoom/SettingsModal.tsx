import { useState, type FormEvent } from "react";
import { Settings, X } from "lucide-react";
import {
  ROOM_DESCRIPTION_MAX,
  ROOM_TITLE_MAX,
  validateRoomDescription,
  validateRoomTitle,
} from "./roomText";

type RoomSettingsValues = {
  title: string;
  topic: string;
  description: string;
  visibility: "public" | "link_only";
  /** Optional product/website link — empty string clears it (max one per room). */
  link: string;
};

type SettingsErrors = {
  title?: string;
  description?: string;
};

/**
 * Premium-feeling room settings sheet — only title/topic/description/
 * visibility plus the optional product/website link (matches server
 * updateSettings + setLink). Lifecycle/host stay server-owned.
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
  const [link, setLink] = useState(initial.link);
  const [errors, setErrors] = useState<SettingsErrors>({});

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: SettingsErrors = {
      title: validateRoomTitle(title) ?? undefined,
      description: validateRoomDescription(description) ?? undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.title || nextErrors.description) return;
    await onSubmit({
      title: title.trim(),
      topic: topic.trim(),
      description: description.trim(),
      visibility,
      link: link.trim(),
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
            Title, topic, description, visibility, and one optional
            product/website link. Lifecycle and host cannot change here.
          </p>
          <label htmlFor="hype-settings-title">
            Title <span className="report-dialog-req">(required)</span>
            <input
              id="hype-settings-title"
              value={title}
              onChange={event => {
                setTitle(event.target.value);
                setErrors(current => ({ ...current, title: undefined }));
              }}
              minLength={3}
              required
              autoComplete="off"
              placeholder={`Room title (3–${ROOM_TITLE_MAX} characters)`}
              aria-invalid={errors.title ? true : undefined}
            />
            {errors.title ? (
              <span className="hype-create-field-error" role="alert">
                {errors.title}
              </span>
            ) : null}
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
              onChange={event => {
                setDescription(event.target.value);
                setErrors(current => ({
                  ...current,
                  description: undefined,
                }));
              }}
              rows={4}
              placeholder={`Room description (max ${ROOM_DESCRIPTION_MAX} characters)`}
              aria-invalid={errors.description ? true : undefined}
            />
            {errors.description ? (
              <span className="hype-create-field-error" role="alert">
                {errors.description}
              </span>
            ) : null}
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
          <label htmlFor="hype-settings-link">
            Product / website link{" "}
            <span className="report-dialog-optional">
              (optional — leave empty to remove)
            </span>
            <input
              id="hype-settings-link"
              value={link}
              onChange={event => setLink(event.target.value)}
              maxLength={2048}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://example.com/product"
            />
          </label>
          {link.trim().length > 0 ? (
            <button
              type="button"
              className="muted-btn hype-settings-remove-link"
              onClick={() => setLink("")}
              disabled={saving}
            >
              Remove link
            </button>
          ) : null}
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
