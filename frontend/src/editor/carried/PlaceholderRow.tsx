import type { KeyboardEvent, ReactNode } from "react";
import { checkStateBadge, type CarriedState } from "./checkState";
import { CarriedStateBadge } from "./CarriedRowExtras";
import { dismissedLine } from "./instructions";
import "./carried-list.css";

/**
 * List row of a carried input without a carried finding on this text (spec section 1). Selectable
 * like a finding row; named "{term}, carried, not on this text, {check state}".
 */
export function PlaceholderRow({ state, termLabel, termText, instruction, selected, onActivate, linkedTo }: {
  state: Pick<CarriedState, "variant" | "unchecked" | "input" | "resolution">;
  termLabel: ReactNode;
  termText: string;
  instruction: string | null;
  selected: boolean;
  onActivate: () => void;
  /** Term of the finding this input was linked to, if any. */
  linkedTo?: string;
}): JSX.Element {
  const badge = checkStateBadge(state.variant);
  const dismissed = state.variant === "dismissed";
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onActivate();
  };
  return (
    <li
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${termText}, carried, not on this text, ${badge.label.toLowerCase()}`}
      data-list-key={`input:${state.input.input_id}`}
      className={["doc-item", "carried-placeholder", selected && "selected", dismissed && "is-muted"].filter(Boolean).join(" ")}
      onClick={onActivate}
      onKeyDown={onKeyDown}
    >
      <div className="doc-id doc-row">
        <span className="carried-placeholder__term">{termLabel}</span>
        <CarriedStateBadge variant={state.variant} />
      </div>
      <div className="carried-extras">
        {badge.line && <p className="carried-extras__line">{badge.line}</p>}
        <p className="carried-placeholder__where">Not on this text</p>
        {dismissed && <p className="carried-placeholder__note">{dismissedLine(state.resolution?.reason ?? "")}</p>}
        {linkedTo && <p className="carried-placeholder__note">Linked to {linkedTo}</p>}
        {state.unchecked && instruction && <p className="carried-instruction">{instruction}</p>}
      </div>
    </li>
  );
}
