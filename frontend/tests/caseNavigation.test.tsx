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

    expect(screen.getByText(/Text 1 of 3|Fall 1 von 3/i)).toBeTruthy();
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

    const prevBtn = screen.getByRole("button", { name: /Previous text|Vorheriger Fall/i });
    const nextBtn = screen.getByRole("button", { name: /Next text|Nächster Fall/i });

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

    const prevBtn = screen.getByRole("button", { name: /Previous text|Vorheriger Fall/i });
    const nextBtn = screen.getByRole("button", { name: /Next text|Nächster Fall/i });

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

    const select = screen.getByRole("combobox", { name: /Select text|Fall auswählen/i });
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

    expect(screen.getByText(/doc-beta.*(Submitted)/i)).toBeTruthy();
    expect(screen.getByText(/doc-alpha.*(In progress)/i)).toBeTruthy();
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

    const prevBtn = screen.getByRole("button", { name: /Previous text|Vorheriger Fall/i });
    const nextBtn = screen.getByRole("button", { name: /Next text|Nächster Fall/i });
    const select = screen.getByRole("combobox", { name: /Select text|Fall auswählen/i });

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

    it("includes cases without review proposals when stepping forward and back", () => {
      const onNavigate = vi.fn().mockResolvedValue(undefined);
      const { rerender } = render(
        <CaseNavigation documents={reviewDocuments} currentDocumentId="doc-beta" onNavigate={onNavigate} />
      );
      fireEvent.click(screen.getByRole("button", { name: /Next text/i }));
      expect(onNavigate).toHaveBeenLastCalledWith("doc-alpha");

      rerender(<CaseNavigation documents={reviewDocuments} currentDocumentId="doc-gamma" onNavigate={onNavigate} />);
      fireEvent.click(screen.getByRole("button", { name: /Previous text/i }));
      expect(onNavigate).toHaveBeenLastCalledWith("doc-alpha");
    });

    it("enables the next button for a later case with no proposals", () => {
      render(
        <CaseNavigation
          documents={[reviewDocuments[0], reviewDocuments[1]]}
          currentDocumentId="doc-beta"
          onNavigate={vi.fn()}
        />
      );
      expect((screen.getByRole("button", { name: /Next text/i }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("keeps cases without proposals available in the case list", () => {
      render(<CaseNavigation documents={reviewDocuments} currentDocumentId="doc-beta" onNavigate={vi.fn()} />);
      const option = screen.getByRole("option", { name: /doc-alpha/ }) as HTMLOptionElement;
      expect(option.disabled).toBe(false);
      expect(option.textContent).not.toMatch(/no proposals/i);
      expect((screen.getByRole("option", { name: /doc-gamma/ }) as HTMLOptionElement).disabled).toBe(false);
    });
  });

  it("hides the prefix all case IDs share so the distinguishing part stays visible", () => {
    const prefix = "raghpo:080fc3a04c91ee45c8986076765f4d4b4f14ddd9:gsc:";
    const documents: DocumentSummary[] = [
      { ...sampleDocuments[0], document_id: `${prefix}100:12011146:native` },
      { ...sampleDocuments[1], document_id: `${prefix}114:18177466:native` },
    ];
    render(<CaseNavigation documents={documents} currentDocumentId={documents[0].document_id} onNavigate={vi.fn()} />);
    expect(screen.getByRole("option", { name: /Text 1 of 2/ }).textContent).toBe("Text 1 of 2: …100:12011146:native (Submitted)");
    expect(screen.getByRole("option", { name: /Text 2 of 2/ }).textContent).toBe("Text 2 of 2: …114:18177466:native (In progress)");
    expect(screen.getByRole("combobox", { name: /Select text/i }).getAttribute("title")).toBe(documents[0].document_id);
  });

  it("keeps IDs whole when they share no long prefix", () => {
    render(<CaseNavigation documents={sampleDocuments} currentDocumentId="doc-beta" onNavigate={vi.fn()} />);
    expect(screen.getByRole("option", { name: /Text 2 of 3/ }).textContent).toBe("Text 2 of 3: doc-alpha (In progress)");
  });

  it("names a text by case ID, language and corrected version, never by its document ID (R-11)", () => {
    const documents: DocumentSummary[] = [
      { ...sampleDocuments[0], document_id: "ready-translation~de~v1", case_id: "synthetic-ready", version: 1 },
      { ...sampleDocuments[1], document_id: "ready-translation~de~v2", case_id: "synthetic-ready", version: 2, origin: "correction", position: 2 },
    ];
    render(<CaseNavigation documents={documents} currentDocumentId={documents[1].document_id} onNavigate={vi.fn()} />);
    expect(screen.getByRole("option", { name: /Text 1 of 2/ }).textContent).toBe("Text 1 of 2: synthetic-ready de (Submitted)");
    expect(screen.getByRole("option", { name: /Text 2 of 2/ }).textContent).toBe("Text 2 of 2: synthetic-ready de v2 corrected (In progress)");
  });

  it("shows Case n of m without the document id", () => {
    render(<CaseNavigation documents={[sampleDocuments[0]]} currentDocumentId="doc-beta" onNavigate={vi.fn()} />);
    const label = screen.getByText("Text 1 of 1");
    expect(label.textContent).toBe("Text 1 of 1");
    expect(label.getAttribute("title")).toBe("doc-beta");
    expect(screen.queryByText(/doc-beta/)).toBeNull();
  });
});
