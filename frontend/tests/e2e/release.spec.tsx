import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaseScreen, type WorkspaceView } from "../../src/app/CaseScreen";
import { api } from "../../src/api/client";

describe("E2E Release Flow - Origin-Neutral Review & Submission", () => {
  const e2eView: WorkspaceView = {
    document: {
      document_id: "doc-e2e-1",
      text: "Patient shows hypotonia 👶🏽 and café-au-lait spots.\nSevere seizure observed.",
      language: "en",
      text_sha256: "sha-doc-rich-text",
    },
    key: {
      package_id: "pkg-release-e2e",
      document_id: "doc-e2e-1",
      annotator_id: "clinician-reviewer",
      mode: "review",
      target_set_id: "target-set-e2e",
    },
    draft: {
      key: {
        package_id: "pkg-release-e2e",
        document_id: "doc-e2e-1",
        annotator_id: "clinician-reviewer",
        mode: "review",
        target_set_id: "target-set-e2e",
      },
      targets: {
        target_set_id: "target-set-e2e",
        targets: [
          { annotation_id: "prop-human", version: "v-human-1" },
          { annotation_id: "prop-tool", version: "v-tool-1" },
        ],
      },
      revision: 0,
      annotations: [
        {
          annotation: {
            annotation_id: "prop-human",
            document_id: "doc-e2e-1",
            hpo_id: "HP:0001252", // Hypotonia
            axes: {
              definition_name: "editor-axes/v1",
              assertion: "present",
              experiencer: null,
              temporality: null,
            },
            evidence_refs: [{ evidence_id: "ev-h", version: "ev-v-1" }],
            provenance: {
              actor: { actor_id: "dr-smith", kind: "human" },
              method: "manual",
            },
          },
          evidence: [
            {
              mention: {
                evidence_id: "ev-h",
                segments: [{ start: 14, end: 23 }],
                cue_segments: [],
              },
              document_id: "doc-e2e-1",
              text_sha256: "sha-doc-rich-text",
              version: "ev-v-1",
            },
          ],
          document_id: "doc-e2e-1",
          text_sha256: "sha-doc-rich-text",
          ontology_sha256: "sha-ont",
          version: "v-human-1",
        },
        {
          annotation: {
            annotation_id: "prop-tool",
            document_id: "doc-e2e-1",
            hpo_id: "HP:0001250", // Seizure
            axes: {
              definition_name: "editor-axes/v1",
              assertion: "present",
              experiencer: null,
              temporality: null,
            },
            evidence_refs: [{ evidence_id: "ev-t", version: "ev-v-2" }],
            provenance: {
              actor: { actor_id: "nlp-model-v2", kind: "tool" },
              method: "model_prediction",
            },
          },
          evidence: [
            {
              mention: {
                evidence_id: "ev-t",
                segments: [{ start: 59, end: 66 }],
                cue_segments: [],
              },
              document_id: "doc-e2e-1",
              text_sha256: "sha-doc-rich-text",
              version: "ev-v-2",
            },
          ],
          document_id: "doc-e2e-1",
          text_sha256: "sha-doc-rich-text",
          ontology_sha256: "sha-ont",
          version: "v-tool-1",
        },
      ],
      evidence: [],
      decisions: [],
      document_checked: false,
    },
    targets: {
      target_set_id: "target-set-e2e",
      targets: [
        { annotation_id: "prop-human", version: "v-human-1" },
        { annotation_id: "prop-tool", version: "v-tool-1" },
      ],
    },
    submissions: [],
    available_inputs: [],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies origin-neutral review UI and complete submission lifecycle", async () => {
    let currentDecisions: any[] = [];
    const recordDecisionSpy = vi
      .spyOn(api, "recordDecision")
      .mockImplementation(async (_wsId, env) => {
        const payload = env.payload as any;
        const newDecision = {
          decision_id: `dec-${payload.target.annotation_id}`,
          target: payload.target,
          outcome: payload.outcome,
          replacement: payload.replacement || null,
          note: payload.note || null,
          reviewer_id: "clinician-reviewer",
        };
        currentDecisions = [
          ...currentDecisions.filter(
            (d) => d.target.annotation_id !== payload.target.annotation_id
          ),
          newDecision,
        ];
        return {
          ...e2eView.draft,
          revision: env.expected_revision + 1,
          decisions: currentDecisions,
        } as any;
      });

    const submitSpy = vi.spyOn(api, "submitWorkspace").mockResolvedValue({
      submission_id: "sub-e2e-final-1",
      origin_key: e2eView.key,
      targets: e2eView.targets,
      draft_revision: 2,
      snapshots: e2eView.draft.annotations as any,
      decisions: [],
      document_checked: true,
      created_at: new Date().toISOString(),
    });

    render(
      <CaseScreen
        view={e2eView}
        workspaceId="ws-e2e-token"
        onClose={vi.fn()}
      />
    );

    // 1. Text pane renders Unicode characters correctly (emoji and accented text)
    expect(screen.getByText(/👶🏽/)).toBeDefined();
    expect(screen.getByText(/café-au-lait/)).toBeDefined();

    // 2. Both human and tool proposals are visible in the list
    expect(screen.getByText("HP:0001252")).toBeDefined();
    expect(screen.getByText("HP:0001250")).toBeDefined();

    // 3. Select Human proposal: verify all 4 review actions are rendered identically
    fireEvent.click(screen.getByText("prop-human"));
    expect(screen.getByRole("button", { name: /Bestätigen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Verwerfen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Ändern/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Unsicher/i })).toBeDefined();

    // Confirm human proposal
    fireEvent.click(screen.getByRole("button", { name: /Bestätigen/i }));
    await waitFor(() => {
      expect(recordDecisionSpy).toHaveBeenCalledWith(
        "ws-e2e-token",
        expect.objectContaining({
          expected_revision: 0,
          payload: expect.objectContaining({
            outcome: "confirmed",
            target: { annotation_id: "prop-human", version: "v-human-1" },
          }),
        })
      );
    });

    // 4. Select Tool proposal: verify the exact same 4 actions are present
    fireEvent.click(screen.getByText("prop-tool"));
    expect(screen.getByRole("button", { name: /Bestätigen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Verwerfen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Ändern/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Unsicher/i })).toBeDefined();

    // Reject tool proposal so all targets are decided
    fireEvent.click(screen.getByRole("button", { name: /Verwerfen/i }));
    await waitFor(() => {
      expect(recordDecisionSpy).toHaveBeenCalledWith(
        "ws-e2e-token",
        expect.objectContaining({
          payload: expect.objectContaining({
            outcome: "rejected",
            target: { annotation_id: "prop-tool", version: "v-tool-1" },
          }),
        })
      );
    });

    // 5. Complete / Submit workspace
    // Toggle document checked confirmation
    const checkbox = screen.getByLabelText(/Dokument vollständig geprüft/i);
    fireEvent.click(checkbox);

    // Click confirm submission
    const submitBtn = screen.getByRole("button", { name: /Fall abschließen & abgeben/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith(
        "ws-e2e-token",
        expect.objectContaining({
          payload: expect.objectContaining({ document_checked: true }),
        })
      );
    });

    // Verification of export link availability after submission
    await waitFor(() => {
      expect(screen.getByText(/Fall erfolgreich abgeschlossen/i)).toBeDefined();
      expect(screen.getByRole("link", { name: /Paket herunterladen/i })).toBeDefined();
    });
  });
});
