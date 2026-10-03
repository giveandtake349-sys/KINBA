import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmented,
  SettingsState,
  SettingsSwitch,
} from "./atoms";

describe("SettingsRow", () => {
  it("renders a plain information row with its value", () => {
    render(
      <SettingsRow kind="information" label="Email" value="me@example.com" />
    );
    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.getByText("me@example.com")).toBeTruthy();
  });

  it("never renders a control for unavailable settings", () => {
    render(
      <SettingsRow
        kind="unavailable"
        label="Private account"
        description="Only approved followers can see your posts"
        note="Needs server-side privacy rules."
      />
    );
    expect(screen.getByText("Private account")).toBeTruthy();
    expect(screen.getByText("Needs server-side privacy rules.")).toBeTruthy();
    expect(screen.getByText("Not available yet")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("listitem").getAttribute("aria-disabled")).toBe(
      "true"
    );
  });

  it("supports a custom badge but keeps the row inert", () => {
    render(
      <SettingsRow kind="unavailable" label="Data saver" badge="Coming later" />
    );
    expect(screen.getByText("Coming later")).toBeTruthy();
    expect(screen.getByRole("listitem").getAttribute("data-kind")).toBe(
      "unavailable"
    );
  });

  it("fires navigation rows and disables them when asked", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <SettingsRow kind="navigation" label="Message requests" onClick={onClick} />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <SettingsRow
        kind="navigation"
        label="Message requests"
        onClick={onClick}
        disabled
      />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("button") as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("marks dangerous rows for the caller to style", () => {
    render(
      <SettingsRow kind="action" label="Sign out everywhere" danger onClick={() => {}} />
    );
    expect(screen.getByRole("listitem").className).toContain(
      "settings-row--danger"
    );
  });
});

describe("SettingsGroup", () => {
  it("renders rows inside a labelled list", () => {
    render(
      <SettingsGroup title="Sessions">
        <SettingsRow kind="information" label="Active sessions" value="2" />
      </SettingsGroup>
    );
    const group = screen.getByRole("group", { name: "Sessions" });
    expect(group).toBeTruthy();
    expect(group.querySelectorAll("li")).toHaveLength(1);
  });

  it("supports a plain body for definition lists", () => {
    render(
      <SettingsGroup title="About" plain>
        <p>Body</p>
      </SettingsGroup>
    );
    expect(screen.getByRole("group", { name: "About" }).querySelector("ul")).toBe(
      null
    );
    expect(screen.getByText("Body")).toBeTruthy();
  });
});

describe("SettingsState", () => {
  it("shows a busy loading state", () => {
    const { container } = render(
      <SettingsState kind="loading" message="Loading your account…" />
    );
    expect(screen.getByText("Loading your account…")).toBeTruthy();
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });

  it("offers a retry that runs", () => {
    const onRetry = vi.fn();
    render(
      <SettingsState kind="error" message="Something broke" onRetry={onRetry} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders an empty state without a retry action", () => {
    render(<SettingsState kind="empty" message="Nothing here yet" />);
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("SettingsSwitch", () => {
  it("exposes the switch role and reports changes", () => {
    const onChange = vi.fn();
    render(
      <SettingsSwitch label="Reduced motion" checked={false} onChange={onChange} />
    );
    const control = screen.getByRole("switch", { name: "Reduced motion" });
    expect(control.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does nothing while disabled", () => {
    const onChange = vi.fn();
    render(
      <SettingsSwitch
        label="Reduced motion"
        checked
        disabled
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SettingsSegmented", () => {
  it("marks exactly one option as checked and reports picks", () => {
    const onChange = vi.fn();
    render(
      <SettingsSegmented
        label="App theme"
        value="dark"
        onChange={onChange}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "system", label: "System" },
        ]}
      />
    );
    const radios = screen.getAllByRole("radio");
    expect(radios.map(radio => radio.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(onChange).toHaveBeenCalledWith("system");
  });
});
