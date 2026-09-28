import { useCallback, useState } from "react";
import {
  useLongPress,
  type LongPressGesture,
  type LongPressHandlers,
} from "@/hooks/useLongPress";
import { haptic } from "@/lib/haptics";
import type { ReactionPickerAnchor } from "./ReactionPicker";

/**
 * Open/close state for a surface's reaction picker plus the long-press binding
 * that feeds it. Long-press anchors at the pointer; a tap anchors to the
 * trigger so the tray never covers the control that opened it.
 *
 * `onLongPress` lets a surface record *which* item opened the tray (long-press
 * carries no React state of its own), and runs before the anchor is set.
 */
export function useReactionPicker(
  enabled = true,
  onLongPress?: (gesture: LongPressGesture) => void
) {
  const [anchor, setAnchor] = useState<ReactionPickerAnchor | null>(null);

  const close = useCallback(() => setAnchor(null), []);

  const openAt = useCallback((x: number, y: number) => {
    haptic("light");
    setAnchor({ x, y });
  }, []);

  const openFromEvent = useCallback(
    (event: { currentTarget: EventTarget & Element }) => {
      const rect = event.currentTarget.getBoundingClientRect();
      haptic("light");
      setAnchor({ x: rect.left + rect.width / 2, y: rect.bottom });
    },
    []
  );

  const longPress: LongPressHandlers = useLongPress({
    enabled,
    onLongPress: gesture => {
      onLongPress?.(gesture);
      openAt(gesture.x, gesture.y);
    },
  });

  return {
    open: anchor !== null,
    anchor,
    openAt,
    openFromEvent,
    close,
    longPress,
  };
}

export type ReactionPickerController = ReturnType<typeof useReactionPicker>;
