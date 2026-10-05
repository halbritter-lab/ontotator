import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaseScreen, type WorkspaceView } from "../../src/app/CaseScreen";
import { api } from "../../src/api/client";

describe("E2E Release Flow - Origin-Neutral Review & Submission", () => {
  const scope = {
    scope_id: "scope-default",
    mode: "review" as const,
    editable_layer_ids: ["phenotype"],
    reference_layer_ids: [],
  };

  const layers = [
    {
      layer_id: "phenotype",
      label: "Phänotyp",
      ontology_id: "hp",
      access: "editable" as const,
      default_visible: true,
      default_type_id: "default",
      annotation_types: [
        {
          type_id: "default",
          label: "Phänotyp",
          evidence_policy: "optional" as const,
          axes: [
            { id: "assertion", label: "Vorhandensein (Assertion)", options: ["present", "absent", "uncertain"], allow_empty: true },
            { id: "experiencer", label: "Betroffene Person (Experiencer)", options: ["patient", "other"], allow_empty: true },
            { id: "temporality", label: "Zeitlicher Bezug (Temporality)", options: ["current", "historical", "future"], allow_empty: true },
          ],
        },
      ],
    },
  ];

  const ontologies = [
    {
      ontology_id: "hp",
      release: "2024-06-25",
      label: "Human Phenotype Ontology",
      sha256: "test-hp-sha",
      format: "obo-graph-json" as const,
    },
  ];

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
      scope_id: "scope-default",
      target_set_id: "target-set-e2e",
    },
    scope,
    layers,
    ontologies,
    checked_layer_ids: [],
    draft: {
      key: {
        package_id: "pkg-release-e2e",
        document_id: "doc-e2e-1",
        annotator_id: "clinician-reviewer",
        mode: "review",
        scope_id: "scope-default",
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
          schema_version: "ontocurator-annotation/v3",
          annotation: {
            annotation_id: "prop-human",
            document_id: "doc-e2e-1",
            layer_id: "phenotype",
            type_id: "default",
            term_id: "HP:0001252",
            axes_values: {
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
          layer_config_sha256: "test-layer-sha",
          version: "v-human-1",
        },
        {
          schema_version: "ontocurator-annotation/v3",
          annotation: {
            annotation_id: "prop-tool",
            document_id: "doc-e2e-1",
            layer_id: "phenotype",
            type_id: "default",
            term_id: "HP:0001250",
            axes_values: {
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
          layer_config_sha256: "test-layer-sha",
          version: "v-tool-1",
        },
      ],
      evidence: [],
      decisions: [],
      checked_layer_ids: [],
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
    term_statuses: {},
    axes_definition: "editor-axes/v1",
    axes_config: [
      { id: "assertion", label: "Vorhandensein (Assertion)", options: ["present", "absent", "uncertain"], allow_empty: true },
      { id: "experiencer", label: "Betroffene Person (Experiencer)", options: ["patient", "other"], allow_empty: true },
      { id: "temporality", label: "Zeitlicher Bezug (Temporality)", options: ["current", "historical", "future"], allow_empty: true },
    ],
    axes_config_sha256: "sha-e2e-axes",
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
      format_version: "ontocurator-work-package/v2",
      submission_id: "sub-e2e-final-1",
      origin_key: e2eView.key,
      scope: e2eView.scope,
      targets: e2eView.targets,
      draft_revision: 2,
      snapshots: e2eView.draft.annotations as any,
      decisions: [],
      checked_layer_ids: ["phenotype"],
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
    fireEvent.click(screen.getAllByText("prop-human")[0]);
    expect(screen.getByRole("button", { name: /Confirm|Bestätigen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject|Verwerfen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Edit|Ändern/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Uncertain|Unsicher/i })).toBeDefined();

    // Confirm human proposal
    fireEvent.click(screen.getByRole("button", { name: /Confirm|Bestätigen/i }));
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
    fireEvent.click(screen.getAllByText("prop-tool")[0]);
    expect(screen.getByRole("button", { name: /Confirm|Bestätigen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject|Verwerfen/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Edit|Ändern/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Uncertain|Unsicher/i })).toBeDefined();

    // Reject tool proposal so all targets are decided
    fireEvent.click(screen.getByRole("button", { name: /Reject|Verwerfen/i }));
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
    // Submitting requires the explicit "entire text checked" confirmation.
    const submitBtn = screen.getByRole("button", { name: /Finish & Submit Case|Fall abschließen & abgeben/i });
    fireEvent.click(submitBtn);
    const dialog = await screen.findByRole("dialog", { name: /Submit case/i });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Entire text checked for further findings/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Submit case$/i }));

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
      expect(screen.getByText(/Case successfully submitted|Fall erfolgreich abgegeben/i)).toBeDefined();
      expect(screen.getByRole("button", { name: /Download Export|Export herunterladen/i })).toBeDefined();
    });
  });
});
