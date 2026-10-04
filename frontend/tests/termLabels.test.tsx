import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { TermName } from "../src/editor/TermName";
import { useTermLabels } from "../src/editor/useTermLabels";

afterEach(() => vi.restoreAllMocks());

it("shows the label from the correct ontology layer beside the stable ID", async () => {
  const lookup = vi.spyOn(api, "resolveTermLabels").mockResolvedValue([
    { layer_id: "hpo", term_id: "X:1", label: "Seizure" },
    { layer_id: "other", term_id: "X:1", label: "Other meaning" },
  ]);
  const terms = [
    { layer_id: "hpo", term_id: "X:1" },
    { layer_id: "other", term_id: "X:1" },
  ];
  function Labels() {
    const label = useTermLabels("pkg", terms);
    return <>
      <TermName termId="X:1" label={label("hpo", "X:1")} />
      <TermName termId="X:1" label={label("other", "X:1")} />
    </>;
  }
  render(<Labels />);
  await waitFor(() => expect(screen.getByText("Seizure")).toBeDefined());
  expect(screen.getByText("Other meaning")).toBeDefined();
  expect(screen.getAllByText("X:1")).toHaveLength(2);
  expect(lookup).toHaveBeenCalledWith("pkg", terms);
});

it("retries a transient label lookup failure", async () => {
  const lookup = vi.spyOn(api, "resolveTermLabels")
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValueOnce([{ layer_id: "hpo", term_id: "HP:0001252", label: "Hypotonia" }]);
  const terms = [{ layer_id: "hpo", term_id: "HP:0001252" }];
  function Label() {
    const label = useTermLabels("pkg", terms);
    return <TermName termId="HP:0001252" label={label("hpo", "HP:0001252")} />;
  }
  render(<Label />);
  await waitFor(() => expect(screen.getByText("Hypotonia")).toBeDefined(), { timeout: 2500 });
  expect(lookup).toHaveBeenCalledTimes(2);
});
