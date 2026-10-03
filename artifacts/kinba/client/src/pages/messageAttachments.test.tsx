/**
 * JHILIK DM attachment UI — "＋" menu and the pending attachment strip.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttachmentMenu, PendingAttachmentStrip } from "./MessageAttachments";
import type { DmPendingAttachment } from "@/lib/dmAttachment";

function pending(
  overrides: Partial<DmPendingAttachment> & Pick<DmPendingAttachment, "id">
): DmPendingAttachment {
  return {
    kind: "image",
    file: new File([new Uint8Array(10)], "photo.png", { type: "image/png" }),
    name: "photo.png",
    size: 2048,
    previewUrl: "blob:http://localhost/photo",
    status: "ready",
    progress: 100,
    ...overrides,
  };
}

describe("AttachmentMenu", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <AttachmentMenu open={false} onPick={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("offers exactly Photos, Video, and Document in that order", () => {
    render(<AttachmentMenu open onPick={vi.fn()} onClose={vi.fn()} />);
    const items = screen
      .getAllByRole("menuitem")
      .map(item => item.textContent?.trim());
    expect(items).toEqual(["Photos", "Video", "Document"]);
  });

  it("reports the picked kind", () => {
    const onPick = vi.fn();
    render(<AttachmentMenu open onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Video" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("video");
  });

  it("closes from the backdrop", () => {
    const onClose = vi.fn();
    render(<AttachmentMenu open onPick={vi.fn()} onClose={onClose} />);
    fireEvent.click(document.querySelector(".attach-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("PendingAttachmentStrip", () => {
  it("renders nothing when there are no pending attachments", () => {
    const { container } = render(
      <PendingAttachmentStrip items={[]} onRemove={vi.fn()} onRetry={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one chip per pending attachment", () => {
    render(
      <PendingAttachmentStrip
        items={[
          pending({ id: "a" }),
          pending({ id: "b", kind: "document", name: "contract.pdf" }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("removes an attachment from its chip", () => {
    const onRemove = vi.fn();
    render(
      <PendingAttachmentStrip
        items={[pending({ id: "a", name: "beach.png" })]}
        onRemove={onRemove}
        onRetry={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText("Remove beach.png"));
    expect(onRemove).toHaveBeenCalledWith("a");
  });

  it("shows live upload progress", () => {
    render(
      <PendingAttachmentStrip
        items={[pending({ id: "a", status: "uploading", progress: 42 })]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("offers a retry action for a failed upload", () => {
    const onRetry = vi.fn();
    render(
      <PendingAttachmentStrip
        items={[pending({ id: "a", status: "error", error: "Attachment is too large." })]}
        onRemove={vi.fn()}
        onRetry={onRetry}
      />
    );
    fireEvent.click(screen.getByLabelText("Retry uploading photo.png"));
    expect(onRetry).toHaveBeenCalledWith("a");
  });

  it("labels a document chip with its kind and size", () => {
    render(
      <PendingAttachmentStrip
        items={[pending({ id: "a", kind: "document", name: "contract.pdf", size: 2048 })]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText("contract.pdf")).toBeTruthy();
    expect(screen.getByText("PDF • 2.0 KB")).toBeTruthy();
  });
});
