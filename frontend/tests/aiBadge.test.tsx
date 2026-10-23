import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiBadge } from "../src/editor/AiBadge";

describe("AiBadge", () => {
  it("marks tool provenance and names tool and method in the tooltip", () => {
    render(<AiBadge provenance={{ actor: { actor_id: "pheno-nlp", kind: "tool" }, method: "llm-v2" }} />);
    const badge = screen.getByLabelText("AI-generated: pheno-nlp, llm-v2");
    expect(badge.textContent).toBe("AI");
    expect(badge.getAttribute("title")).toBe("AI-generated: pheno-nlp, llm-v2");
    expect(badge.classList.contains("badge-ai")).toBe(true);
  });

  it("renders nothing for human provenance", () => {
    const { container } = render(
      <AiBadge provenance={{ actor: { actor_id: "dr-weber", kind: "human" }, method: "manual" }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
