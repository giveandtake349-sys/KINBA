import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Users } from "lucide-react";
import { REACTION_OPTIONS, type ReactionType } from "@shared/reactions";
import { haptic } from "@/lib/haptics";
import "./reactions.css";

export type ReactionPickerAnchor = { x: number; y: number };

export type ReactionPickerProps = {
  open: boolean;
  anchor: ReactionPickerAnchor | null;
  /** The viewer's currently active type, highlighted with aria-checked. */
  active?: ReactionType | null;
  onSelect: (reaction: ReactionType) => void;
  onClose: () => void;
  /** Optional second entry point to the M6 reactor list. */
  onOpenReactors?: () => void;
  disabled?: boolean;
  label?: string;
};

const VIEWPORT_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Shared four-option reaction picker (M4).
 *
 * Portalled to the body so it escapes every feed/shorts positioning context,
 * anchored to the pointer (long-press) or to its trigger (tap), and dismissable
 * by Escape, outside click, or choosing an option. Selecting the already-active
 * option removes it and any other option replaces it — the server owns that
 * rule; this component only reports the choice.
 */
export function ReactionPicker({
  open,
  anchor,
  active,
  onSelect,
  onClose,
  onOpenReactors,
  disabled = false,
  label = "Choose a reaction",
}: ReactionPickerProps) {
  const trayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    trayRef.current?.focus({ preventScroll: true });
    return () => {
      previousFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const tray = trayRef.current;
    if (!tray) return;
    const rect = tray.getBoundingClientRect();
    const left = clamp(
      anchor.x - rect.width / 2,
      VIEWPORT_MARGIN,
      window.innerWidth - rect.width - VIEWPORT_MARGIN
    );
    const above = anchor.y - rect.height - 12;
    const top =
      above >= VIEWPORT_MARGIN
        ? above
        : clamp(anchor.y + 12, VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    tray.style.left = `${left}px`;
    tray.style.top = `${top}px`;
    tray.style.transform = "none";
  }, [open, anchor]);

  if (!open || !anchor) return null;

  return createPortal(
    <div className="reaction-picker-layer" role="presentation">
      <div
        className="reaction-picker-backdrop"
        onClick={onClose}
        onContextMenu={event => event.preventDefault()}
      />
      <div
        ref={trayRef}
        className="reaction-picker"
        role="menu"
        aria-label={label}
        tabIndex={-1}
        style={{
          left: anchor.x,
          top: anchor.y,
          transform: "translate(-50%, calc(-100% - 12px))",
        }}
      >
        <div className="reaction-picker__row">
          {REACTION_OPTIONS.map(option => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              className="reaction-picker__option"
              aria-checked={active === option.id}
              aria-label={option.label}
              title={option.label}
              disabled={disabled}
              onClick={() => {
                haptic("medium");
                onSelect(option.id);
                onClose();
              }}
            >
              <span className="reaction-picker__glyph" aria-hidden="true">
                {option.glyph}
              </span>
              <span className="reaction-picker__label">{option.label}</span>
            </button>
          ))}
        </div>
        {onOpenReactors ? (
          <button
            type="button"
            className="reaction-picker__footer"
            onClick={() => {
              onOpenReactors();
              onClose();
            }}
          >
            <Users size={14} aria-hidden="true" />
            See who reacted
          </button>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
