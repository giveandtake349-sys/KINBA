import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ConversationAction } from "./shared";

/**
 * Professional overflow action menu (Hype Room pattern).
 * Escape / outside-click close; actions only include authorized items
 * supplied by the caller.
 */
export function ActionMenu({
  actions,
  ariaLabel = "More actions",
  disabled,
}: {
  actions: ConversationAction[];
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div className="conv-action-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="conv-action-menu-trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={event => {
          event.stopPropagation();
          setOpen(value => !value);
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {open ? (
        <div className="conv-action-menu-panel" role="menu">
          {actions.map(action => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className={
                action.danger
                  ? "conv-action-menu-item conv-action-menu-item--danger"
                  : "conv-action-menu-item"
              }
              onClick={event => {
                event.stopPropagation();
                setOpen(false);
                action.run();
              }}
            >
              <span className="conv-action-menu-icon" aria-hidden="true">
                {action.icon}
              </span>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
