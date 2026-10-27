import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguagesField, type LanguagesFieldProps } from "../src/admin/LanguagesField";

afterEach(() => cleanup());

const props = (extra: Partial<LanguagesFieldProps> = {}): LanguagesFieldProps => ({
  id: "languages", label: "Languages you can read", value: [], onChange: vi.fn(), ...extra,
});

function Form({ onSave, initial = [] }: { onSave: (languages: string[]) => void; initial?: string[] }) {
  const [value, setValue] = useState(initial);
  return <form aria-label="Profile" onSubmit={(event) => { event.preventDefault(); onSave(value); }}>
    <LanguagesField {...props({ value, onChange: setValue })} />
    <button type="submit">Save</button>
  </form>;
}

describe("LanguagesField", () => {
  it("labels the input and suggests common codes without preselecting a language", () => {
    const state = props();
    render(<LanguagesField {...state} />);
    const input = screen.getByLabelText("Languages you can read") as HTMLInputElement;
    expect(input.id).toBe("languages");
    expect(input.value).toBe("");
    fireEvent.focus(input);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["de", "en", "es", "fr", "it", "nl", "pt", "pl"]);
    expect(state.onChange).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Add language" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("normalises an explicit keyboard addition and does not submit the surrounding form", async () => {
    const onSave = vi.fn();
    render(<Form onSave={onSave} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Languages you can read"), " DE {Enter}");
    expect(screen.getByRole("button", { name: "Remove de" })).toBeDefined();
    expect((screen.getByLabelText("Languages you can read") as HTMLInputElement).value).toBe("");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("picks a suggestion by arrow keys and Enter; the list sits under the field and hides chosen codes", async () => {
    const state = props({ value: ["en"] });
    render(<LanguagesField {...state} />);
    const user = userEvent.setup();
    const input = screen.getByLabelText("Languages you can read");
    await user.type(input, "e");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["es"]);
    expect(screen.getByRole("listbox").closest(".suggest-field")?.contains(input)).toBe(true);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(state.onChange).toHaveBeenCalledWith(["en", "es"]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("accepts a two-letter free entry through Add", async () => {
    const state = props({ value: ["en"] });
    render(<LanguagesField {...state} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Languages you can read"), "SV");
    await user.click(screen.getByRole("button", { name: "Add language" }));
    expect(state.onChange).toHaveBeenCalledOnce();
    expect(state.onChange).toHaveBeenCalledWith(["en", "sv"]);
  });

  it("does not add duplicate codes after normalization", async () => {
    const state = props({ value: ["de"] });
    render(<LanguagesField {...state} />);
    await userEvent.setup().type(screen.getByLabelText("Languages you can read"), "DE{Enter}");
    expect(state.onChange).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Remove de" })).toHaveLength(1);
    expect((screen.getByLabelText("Languages you can read") as HTMLInputElement).value).toBe("");
  });

  it.each(["deu", "d", "d1", "1a", "éé", "日本"])("refuses invalid code %j with the approved inline error", async (code) => {
    const state = props();
    render(<LanguagesField {...state} />);
    const input = screen.getByLabelText("Languages you can read") as HTMLInputElement;
    await userEvent.setup().type(input, `${code}{Enter}`);
    const error = screen.getByRole("alert");
    expect(error.textContent).toBe("Use a two-letter language code, e.g. de.");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.value).toBe(code);
    expect(state.onChange).not.toHaveBeenCalled();
  });

  it("removes a token accessibly and permits the empty list", async () => {
    const state = props({ value: ["de"] });
    render(<LanguagesField {...state} />);
    const remove = screen.getByRole("button", { name: "Remove de" }) as HTMLButtonElement;
    expect(remove.type).toBe("button");
    expect((screen.getByRole("button", { name: "Add language" }) as HTMLButtonElement).type).toBe("button");
    remove.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(state.onChange).toHaveBeenCalledWith([]);
    expect(document.activeElement).toBe(screen.getByLabelText("Languages you can read"));
  });

  it("uses the controlled value when a parent updates the selected languages", () => {
    const state = props({ value: ["en"] });
    const { rerender } = render(<LanguagesField {...state} />);
    rerender(<LanguagesField {...state} value={["de", "pl"]} />);
    expect(screen.queryByRole("button", { name: "Remove en" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove de" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove pl" })).toBeDefined();
    expect(state.onChange).not.toHaveBeenCalled();
  });

  it("disables entry, addition and removal without changing the value", async () => {
    const state = props({ value: ["en"], disabled: true });
    render(<LanguagesField {...state} />);
    const input = screen.getByLabelText("Languages you can read") as HTMLInputElement;
    const user = userEvent.setup();
    expect(input.disabled).toBe(true);
    await user.type(input, "de{Enter}");
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      await user.click(button);
    }
    expect(state.onChange).not.toHaveBeenCalled();
  });

  it("commits pending valid input on blur before an ordinary form Save", async () => {
    const onSave = vi.fn();
    render(<Form initial={["en"]} onSave={onSave} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Languages you can read"), "DE");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith(["en", "de"]);
  });

  it("blocks Save for invalid pending text and retains it for correction", async () => {
    const onSave = vi.fn();
    render(<Form onSave={onSave} />);
    const user = userEvent.setup();
    const input = screen.getByLabelText("Languages you can read") as HTMLInputElement;
    await user.type(input, "deu");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(input.value).toBe("deu");
    expect(screen.getByRole("alert").textContent).toBe("Use a two-letter language code, e.g. de.");
    await user.clear(input);
    await user.type(input, "de{Enter}");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(["de"]);
  });

  it("blocks requestSubmit while valid text is uncommitted and focused", async () => {
    const onSave = vi.fn();
    render(<Form onSave={onSave} />);
    const user = userEvent.setup();
    const input = screen.getByLabelText("Languages you can read") as HTMLInputElement;
    await user.type(input, "en");
    act(() => (screen.getByRole("form", { name: "Profile" }) as HTMLFormElement).requestSubmit());
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Add this language code before saving.");
    await user.keyboard("{Enter}");
    act(() => (screen.getByRole("form", { name: "Profile" }) as HTMLFormElement).requestSubmit());
    expect(onSave).toHaveBeenCalledWith(["en"]);
  });

  it("ignores Enter while composing text", () => {
    const state = props();
    render(<LanguagesField {...state} />);
    const input = screen.getByLabelText("Languages you can read");
    fireEvent.change(input, { target: { value: "de" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(state.onChange).not.toHaveBeenCalled();
  });
});
