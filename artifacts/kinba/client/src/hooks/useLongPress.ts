/**
 * Long-press gesture for reaction pickers.
 *
 * A pointer held for `thresholdMs` without leaving an `slopPx` box fires
 * `onLongPress` once. The gesture is deliberately isolated from the element's
 * normal tap: the trailing click is swallowed in the capture phase so a
 * long-press can never also activate the tap action, while a short tap never
 * fires `onLongPress` at all. Moving cancels the hold (and scrolling takes the
 * pointer down with it via `pointercancel`), so releasing without choosing a
 * reaction performs no mutation.
 */
import { useCallback, useEffect, useRef } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

export const LONG_PRESS_THRESHOLD_MS = 450;
export const LONG_PRESS_SLOP_PX = 8;
/** Long enough to cover the click some browsers still dispatch on release. */
const CLICK_SUPPRESS_WINDOW_MS = 750;

export type LongPressGesture = {
  x: number;
  y: number;
  target: EventTarget | null;
};

export type LongPressOptions = {
  onLongPress: (gesture: LongPressGesture) => void;
  thresholdMs?: number;
  slopPx?: number;
  enabled?: boolean;
};

export type LongPressHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
};

export function useLongPress({
  onLongPress,
  thresholdMs = LONG_PRESS_THRESHOLD_MS,
  slopPx = LONG_PRESS_SLOP_PX,
  enabled = true,
}: LongPressOptions): LongPressHandlers {
  const fireRef = useRef(onLongPress);
  fireRef.current = onLongPress;

  const pointerIdRef = useRef<number | null>(null);
  const pointerTypeRef = useRef<string | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const clearSuppress = useCallback(() => {
    if (suppressTimerRef.current !== null) {
      clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearHold();
      clearSuppress();
    },
    [clearHold, clearSuppress]
  );

  const fire = useCallback((x: number, y: number, target: EventTarget | null) => {
    firedRef.current = true;
    fireRef.current({ x, y, target });
  }, []);

  return {
    onPointerDown(event) {
      firedRef.current = false;
      clearSuppress();
      pointerTypeRef.current = event.pointerType || null;
      if (!enabled) return;
      // Only the primary button starts a hold; right-click is handled by
      // onContextMenu so the browser menu can still be suppressed deliberately.
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!event.isPrimary) return;
      pointerIdRef.current = event.pointerId;
      originRef.current = { x: event.clientX, y: event.clientY };
      clearHold();
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        fire(event.clientX, event.clientY, event.target);
      }, thresholdMs);
    },
    onPointerMove(event) {
      if (pointerIdRef.current !== event.pointerId) return;
      const dx = event.clientX - originRef.current.x;
      const dy = event.clientY - originRef.current.y;
      if (Math.hypot(dx, dy) > slopPx) {
        pointerIdRef.current = null;
        clearHold();
      }
    },
    onPointerUp(event) {
      if (pointerIdRef.current !== event.pointerId) return;
      pointerIdRef.current = null;
      clearHold();
      if (firedRef.current) {
        clearSuppress();
        suppressTimerRef.current = setTimeout(() => {
          suppressTimerRef.current = null;
          firedRef.current = false;
        }, CLICK_SUPPRESS_WINDOW_MS);
      }
    },
    onPointerCancel(event) {
      if (pointerIdRef.current !== event.pointerId) return;
      pointerIdRef.current = null;
      clearHold();
    },
    onContextMenu(event) {
      if (!enabled) return;
      // Touch/pen reuses contextmenu for the same hold; swallow the native menu
      // so it never covers the picker. Mouse right-click keeps its menu.
      if (pointerTypeRef.current !== "touch" && pointerTypeRef.current !== "pen") {
        return;
      }
      event.preventDefault();
      if (firedRef.current) return;
      fire(event.clientX, event.clientY, event.target);
    },
    onClickCapture(event) {
      if (!firedRef.current) return;
      firedRef.current = false;
      clearSuppress();
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
