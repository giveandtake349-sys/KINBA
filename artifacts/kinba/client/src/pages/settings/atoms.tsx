import type { ReactNode } from "react";
import { ChevronRight, CircleAlert, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { UNAVAILABLE_LABEL, type SettingsRowKind } from "./model";
import "./settings.css";

/* -------------------------------------------------------------------------- */
/* Layout atoms                                                                */
/* -------------------------------------------------------------------------- */

export function SettingsGroup({
  title,
  hint,
  children,
  plain = false,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  /** Render children in a plain container (definition lists, not rows). */
  plain?: boolean;
}) {
  return (
    <section className="settings-group" role="group" aria-label={title}>
      <h3 className="settings-group__title">{title}</h3>
      {hint ? <p className="settings-group__hint">{hint}</p> : null}
      {plain ? (
        <div className="settings-group__body">{children}</div>
      ) : (
        <ul className="settings-group__list">{children}</ul>
      )}
    </section>
  );
}

export function SettingsNote({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "info" | "warning";
}) {
  return (
    <p className={cn("settings-note", `settings-note--${tone}`)} role="note">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Row atom                                                                    */
/* -------------------------------------------------------------------------- */

export type SettingsRowProps = {
  label: string;
  description?: string;
  /** Extra explanation shown under the description (why an action matters). */
  note?: string;
  kind?: SettingsRowKind;
  /** Right-aligned read value (information rows). */
  value?: ReactNode;
  /** Right-aligned interactive control (switch, segmented control, button). */
  control?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Overrides the standard "Not available yet" badge. */
  badge?: string;
  /** Hide the trailing chevron on navigation rows. */
  hideChevron?: boolean;
  "data-testid"?: string;
};

export function SettingsRow({
  label,
  description,
  note,
  kind = "information",
  value,
  control,
  onClick,
  disabled = false,
  danger = false,
  badge,
  hideChevron = false,
  "data-testid": testId,
}: SettingsRowProps) {
  const unavailable = kind === "unavailable";
  const interactive = !unavailable && !disabled && Boolean(onClick);
  const copy = (
    <span className="settings-row__copy">
      <span className="settings-row__label">{label}</span>
      {description ? (
        <span className="settings-row__description">{description}</span>
      ) : null}
      {note ? <span className="settings-row__note">{note}</span> : null}
    </span>
  );

  return (
    <li
      className={cn(
        "settings-row",
        unavailable && "settings-row--unavailable",
        disabled && !unavailable && "settings-row--disabled",
        danger && "settings-row--danger",
        interactive && "settings-row--interactive"
      )}
      data-kind={kind}
      data-testid={testId}
      aria-disabled={unavailable || disabled || undefined}
    >
      {unavailable ? (
        <div className="settings-row__static">
          {copy}
          <span className="settings-badge" title="Not backed by JHILIK yet">
            <Lock size={14} aria-hidden="true" />
            {badge ?? UNAVAILABLE_LABEL}
          </span>
        </div>
      ) : control ? (
        <>
          <div
            className="settings-row__static"
            onClick={disabled ? undefined : onClick}
          >
            {copy}
          </div>
          <div className="settings-row__control">{control}</div>
        </>
      ) : onClick ? (
        <button
          type="button"
          className="settings-row__button"
          onClick={onClick}
          disabled={disabled}
        >
          {copy}
          {value != null ? (
            <span className="settings-row__value">{value}</span>
          ) : null}
          {kind === "navigation" && !hideChevron ? (
            <ChevronRight size={18} aria-hidden="true" />
          ) : null}
        </button>
      ) : (
        <div className="settings-row__static">
          {copy}
          {value != null ? (
            <span className="settings-row__value">{value}</span>
          ) : badge ? (
            <span className="settings-badge">{badge}</span>
          ) : null}
        </div>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Query states                                                                */
/* -------------------------------------------------------------------------- */

export type SettingsStateKind = "loading" | "error" | "empty";

export function SettingsState({
  kind,
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  kind: SettingsStateKind;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const Icon = kind === "loading" ? Loader2 : CircleAlert;
  return (
    <div
      className={cn("settings-state", `settings-state--${kind}`)}
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading" || undefined}
    >
      <Icon
        size={18}
        aria-hidden="true"
        className={kind === "loading" ? "settings-state__spinner" : undefined}
      />
      <p>{message}</p>
      {kind === "error" && onRetry ? (
        <button type="button" className="settings-btn settings-btn--ghost" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

export function SettingsButton({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  busy = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={cn(
        "settings-btn",
        `settings-btn--${variant}`,
        busy && "settings-btn--busy"
      )}
      onClick={onClick}
      disabled={disabled || busy}
    >
      {busy ? <Loader2 size={14} aria-hidden="true" className="settings-state__spinner" /> : null}
      {children}
    </button>
  );
}

export function SettingsField({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className={cn("settings-field", error && "settings-field--error")}>
      <label className="settings-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="settings-field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="settings-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function SettingsFormMessage({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: ReactNode;
}) {
  if (!children) return null;
  return (
    <p
      className={cn("settings-form-message", `settings-form-message--${tone}`)}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

/**
 * Toggle backed by a real value (persisted locally or sent to the API).
 * Rendered as a native button with `role="switch"` so keyboard users keep the
 * expected behaviour without pulling a new dependency into the page.
 */
export function SettingsSwitch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cn("settings-switch", checked && "settings-switch--on")}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch__thumb" aria-hidden="true" />
    </button>
  );
}

export function SettingsSegmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div
      className="settings-segmented"
      role="radiogroup"
      aria-label={label}
    >
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={cn("settings-segmented__item", active && "is-active")}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
