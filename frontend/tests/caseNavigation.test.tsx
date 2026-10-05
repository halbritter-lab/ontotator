import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CaseNavigation } from "../src/app/CaseNavigation";
import type { DocumentSummary } from "../src/api/client";

describe("CaseNavigation Component", () => {
  // Non-alphabetical document package order: doc-beta, doc-alpha, doc-gamma
  const sampleDocuments: DocumentSummary[] = [
    {
      document_id: "doc-beta",
      text_length: 120,
      language: "de",
      position: 1,
      status: "completed",
    },
    {
      document_id: "doc-alpha",
      text_length: 250,
      language: "de",
      position: 2,
      status: "in_progress",
    },
    {
      document_id: "doc-gamma",
      text_length: 300,
      language: "en",
      position: 3,
      status: "not_started",
    },
  ];

  it("displays current position and total based on package order", () => {
    render(
      <CaseNavigation
        documents={sampleDocuments}
        currentDocumentId="doc-beta"
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByText(/Case 1 of 3|Fall 1 von 3/i)).toBeTruthy();
  });

  it("disables previous button on first case and allows next button", () => {
    const onNavigate = vi.fn().mockResolvedValue(undefined);
    render(
      <CaseNavigation
        documents={sampleDocuments}
        currentDocumentId="doc-beta"
        onNavigate={onNavigate}
      />
    );

    const prevBtn = screen.getByRole("button", { name: /Previous Case|Vorheriger Fall/i });
    const nextBtn = screen.getByRole("button", { name: /Next Case|Nächster Fall/i });

    expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(nextBtn);
    expect(onNavigate).toHaveBeenCalledWith("doc-alpha");
  });

  it("disables next button on last case and allows previous button", () => {
    const onNavigate = vi.fn().mockResolvedValue(undefined);
    render(
      <CaseNavigation
        documents={sampleDocuments}
        currentDocumentId="doc-gamma"
        onNavigate={onNavigate}
      />
    );

    const prevBtn = screen.getByRole("button", { name: /Previous Case|Vorheriger Fall/i });
    const nextBtn = screen.getByRole("button", { name: /Next Case|Nächster Fall/i });

    expect((prevBtn as HTMLButtonElement).disabled).toBe(false);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(prevBtn);
    expect(onNavigate).toHaveBeenCalledWith("doc-alpha");
  });

  it("allows direct jump via dropdown", () => {
    const onNavigate = vi.fn().mockResolvedValue(undefined);
    render(
      <CaseNavigation
        documents={sampleDocuments}
        currentDocumentId="doc-beta"
        onNavigate={onNavigate}
      />
    );

    const select = screen.getByRole("combobox", { name: /Select case|Fall auswählen/i });
    fireEvent.change(select, { target: { value: "doc-gamma" } });

    expect(onNavigate).toHaveBeenCalledWith("doc-gamma");
  });

  it("displays human-readable case status in dropdown options", () => {
    render(
      <CaseNavigation
        documents={sampleDocuments}
        currentDocumentId="doc-beta"
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByText(/doc-beta.*(Completed|Abgeschlossen)/i)).toBeTruthy();
    expect(screen.getByText(/doc-alpha.*(In Progress|In Bearbeitung)/i)).toBeTruthy();
    expect(screen.getByText(/doc-gamma.*(Open|Nicht begonnen)/i)).toBeTruthy();
  });

  it("disables all controls when disabled prop is true (e.g. saving/flushing)", () => {
    render(
      <CaseNavigation
        documents={sampleDocuments}
        currentDocumentId="doc-alpha"
        onNavigate={vi.fn()}
        disabled={true}
      />
    );

    const prevBtn = screen.getByRole("button", { name: /Previous Case|Vorheriger Fall/i });
    const nextBtn = screen.getByRole("button", { name: /Next Case|Nächster Fall/i });
    const select = screen.getByRole("combobox", { name: /Select case|Fall auswählen/i });

    expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
    expect((select as HTMLSelectElement).disabled).toBe(true);
  });

  describe("review mode", () => {
    // has_review_inputs is only set when the list was fetched for review mode.
    const reviewDocuments: DocumentSummary[] = [
      { ...sampleDocuments[0], has_review_inputs: true },
      { ...sampleDocuments[1], has_review_inputs: false },
      { ...sampleDocuments[2], has_review_inputs: true },
    ];

    it("skips cases without review proposals when stepping forward and back", () => {
      const onNavigate = vi.fn().mockResolvedValue(undefined);
      const { rerender } = render(
        <CaseNavigation documents={reviewDocuments} currentDocumentId="doc-beta" onNavigate={onNavigate} />
      );
      fireEvent.click(screen.getByRole("button", { name: /Next Case/i }));
      expect(onNavigate).toHaveBeenLastCalledWith("doc-gamma");

      rerender(<CaseNavigation documents={reviewDocuments} currentDocumentId="doc-gamma" onNavigate={onNavigate} />);
      fireEvent.click(screen.getByRole("button", { name: /Previous Case/i }));
      expect(onNavigate).toHaveBeenLastCalledWith("doc-beta");
    });

    it("disables the next button when no later case has proposals", () => {
      render(
        <CaseNavigation
          documents={[reviewDocuments[0], reviewDocuments[1]]}
          currentDocumentId="doc-beta"
          onNavigate={vi.fn()}
        />
      );
      expect((screen.getByRole("button", { name: /Next Case/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("marks cases without proposals as unavailable in the case list", () => {
      render(<CaseNavigation documents={reviewDocuments} currentDocumentId="doc-beta" onNavigate={vi.fn()} />);
      const option = screen.getByRole("option", { name: /doc-alpha/ }) as HTMLOptionElement;
      expect(option.disabled).toBe(true);
      expect(option.textContent).toMatch(/no proposals/i);
      expect((screen.getByRole("option", { name: /doc-gamma/ }) as HTMLOptionElement).disabled).toBe(false);
    });
  });
});
