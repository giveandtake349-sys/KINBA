import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RoomLinkBar, roomLinkLabel, safeRoomLink } from "./RoomLinkBar";

describe("safeRoomLink", () => {
  it("keeps absolute http(s) URLs", () => {
    expect(safeRoomLink("https://shop.example.com/deal")).toBe(
      "https://shop.example.com/deal"
    );
    expect(safeRoomLink("http://example.org/")).toBe("http://example.org/");
    expect(safeRoomLink("  https://a.example/b  ")).toBe("https://a.example/b");
  });

  it("drops empty, malformed and non-web input", () => {
    expect(safeRoomLink(null)).toBeNull();
    expect(safeRoomLink(undefined)).toBeNull();
    expect(safeRoomLink("")).toBeNull();
    expect(safeRoomLink("   ")).toBeNull();
    expect(safeRoomLink("not a url")).toBeNull();
    expect(safeRoomLink("javascript:alert(1)")).toBeNull();
    expect(safeRoomLink("data:text/html,<script></script>")).toBeNull();
    expect(safeRoomLink("vbscript:msgbox")).toBeNull();
  });
});

describe("roomLinkLabel", () => {
  it("shows the bare host for a root URL and strips www", () => {
    expect(roomLinkLabel("https://www.example.com/")).toBe("example.com");
  });

  it("keeps the path when it adds context", () => {
    expect(roomLinkLabel("https://shop.example.com/deals/summer")).toBe(
      "shop.example.com/deals/summer"
    );
  });
});

describe("RoomLinkBar", () => {
  it("renders nothing when the room has no link", () => {
    const { container } = render(<RoomLinkBar url={null} canManage={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for an unsafe or malformed link", () => {
    const { container: unsafe } = render(
      <RoomLinkBar url="javascript:alert(1)" canManage={false} />
    );
    expect(unsafe.firstChild).toBeNull();

    const { container: broken } = render(
      <RoomLinkBar url="nope" canManage={false} />
    );
    expect(broken.firstChild).toBeNull();
  });

  it("opens the link in a new tab with a safe rel", () => {
    render(
      <RoomLinkBar url="https://shop.example.com/deal" canManage={false} />
    );

    const anchor = screen.getByRole("link", {
      name: /shop\.example\.com\/deal/i,
    });
    expect(anchor.getAttribute("href")).toBe("https://shop.example.com/deal");
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toContain("noopener");
    expect(anchor.getAttribute("rel")).toContain("nofollow");
  });

  it("shows the edit entry point only to the host", () => {
    const onManage = vi.fn();
    const { rerender } = render(
      <RoomLinkBar
        url="https://shop.example.com/deal"
        canManage={false}
        onManage={onManage}
      />
    );
    expect(screen.queryByRole("button", { name: "Edit room link" })).toBeNull();

    rerender(
      <RoomLinkBar
        url="https://shop.example.com/deal"
        canManage
        onManage={onManage}
      />
    );
    const edit = screen.getByRole("button", { name: "Edit room link" });
    fireEvent.click(edit);
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it("disables the edit button while a link mutation is in flight", () => {
    render(
      <RoomLinkBar
        url="https://shop.example.com/deal"
        canManage
        busy
        onManage={vi.fn()}
      />
    );
    const edit = screen.getByRole("button", { name: "Edit room link" });
    expect((edit as HTMLButtonElement).disabled).toBe(true);
  });
});
