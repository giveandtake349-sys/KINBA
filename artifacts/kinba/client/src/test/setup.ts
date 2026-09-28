import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without `globals: true`, so React Testing Library cannot hook
// its own auto-cleanup — reset the DOM after every case instead.
afterEach(() => {
  cleanup();
});

// jsdom ships no PointerEvent, and the shared long-press gesture is
// pointer-driven. Give it the minimum shape React needs to build its
// synthetic event (skipped outside the jsdom environment).
if (
  typeof window !== "undefined" &&
  typeof window.PointerEvent !== "function"
) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
