import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LONG_PRESS_SLOP_PX,
  LONG_PRESS_THRESHOLD_MS,
  useLongPress,
} from "@/hooks/useLongPress";

type HarnessProps = {
  onLongPress: (gesture: { x: number; y: number; target: EventTarget | null }) => void;
  onClick?: () => void;
  enabled?: boolean;
};

function Harness({ onLongPress, onClick, enabled }: HarnessProps) {
  const handlers = useLongPress({ onLongPress, enabled });
  return (
    <button type="button" data-testid="target" onClick={onClick} {...handlers}>
      press me
    </button>
  );
}

const pointer = {
  pointerId: 7,
  pointerType: "touch",
  isPrimary: true,
  button: 0,
  clientX: 40,
  clientY: 60,
};

function hold(target: HTMLElement, ms: number) {
  fireEvent.pointerDown(target, pointer);
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useLongPress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once the hold crosses the threshold", () => {
    const onLongPress = vi.fn();
    const { getByTestId } = render(<Harness onLongPress={onLongPress} />);
    const target = getByTestId("target");

    hold(target, LONG_PRESS_THRESHOLD_MS - 1);
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith({
      x: pointer.clientX,
      y: pointer.clientY,
      target: expect.anything(),
    });
  });

  it("does not fire for a tap that is released early", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { getByTestId } = render(
      <Harness onLongPress={onLongPress} onClick={onClick} />
    );
    const target = getByTestId("target");

    fireEvent.pointerDown(target, pointer);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS - 5);
    });
    fireEvent.pointerUp(target, pointer);
    fireEvent.click(target);

    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("cancels when the pointer moves outside the slop box", () => {
    const onLongPress = vi.fn();
    const { getByTestId } = render(<Harness onLongPress={onLongPress} />);
    const target = getByTestId("target");

    fireEvent.pointerDown(target, pointer);
    fireEvent.pointerMove(target, {
      ...pointer,
      clientX: pointer.clientX + LONG_PRESS_SLOP_PX + 4,
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS * 2);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("cancels on pointercancel so scrolling never reacts", () => {
    const onLongPress = vi.fn();
    const { getByTestId } = render(<Harness onLongPress={onLongPress} />);
    const target = getByTestId("target");

    fireEvent.pointerDown(target, pointer);
    fireEvent.pointerCancel(target, pointer);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS * 2);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("swallows the trailing click so a long-press never also taps", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { getByTestId } = render(
      <Harness onLongPress={onLongPress} onClick={onClick} />
    );
    const target = getByTestId("target");

    hold(target, LONG_PRESS_THRESHOLD_MS);
    fireEvent.pointerUp(target, pointer);
    fireEvent.click(target);

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    // The suppression window ends, so the next tap behaves normally again.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(target);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("stays inert when disabled", () => {
    const onLongPress = vi.fn();
    const { getByTestId } = render(
      <Harness onLongPress={onLongPress} enabled={false} />
    );
    const target = getByTestId("target");

    hold(target, LONG_PRESS_THRESHOLD_MS * 2);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("reuses the touch contextmenu for the hold and blocks the native menu", () => {
    const onLongPress = vi.fn();
    const { getByTestId } = render(<Harness onLongPress={onLongPress} />);
    const target = getByTestId("target");

    fireEvent.pointerDown(target, pointer);
    const contextMenu = fireEvent.contextMenu(target, {
      clientX: pointer.clientX,
      clientY: pointer.clientY,
    });

    expect(contextMenu).toBe(false); // default prevented
    expect(onLongPress).toHaveBeenCalledTimes(1);

    // Already fired: a second contextmenu must not open a second tray.
    fireEvent.contextMenu(target, { clientX: 10, clientY: 10 });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});
