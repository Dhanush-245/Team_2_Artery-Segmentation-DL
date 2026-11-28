export type VolumeSection = { id: string; label: string };

/** The twelve sections of a 3D case, in workflow order. Each id is the anchor of a block on the same page,
 *  so every section reads the same case, source volume and saved run. */
export const VOLUME_SECTIONS: VolumeSection[] = [
  { id: "v3d-overview", label: "Overview" },
  { id: "v3d-source", label: "Source & preprocessing" },
  { id: "v3d-viewer", label: "3D & MPR viewer" },
  { id: "v3d-segmentation", label: "Segmentation" },
  { id: "v3d-candidates", label: "Stenosis candidates" },
  { id: "v3d-measurements", label: "Measurements" },
  { id: "v3d-vessel", label: "Vessel analysis & CPR" },
  { id: "v3d-severity", label: "Severity" },
  { id: "v3d-xai", label: "Explainable AI" },
  { id: "v3d-evaluation", label: "Model evaluation" },
  { id: "v3d-review", label: "Review & history" },
  { id: "v3d-reports", label: "Reports & exports" },
];

/** Section whose anchor is nearest above the reading line, whatever order the blocks sit in on the page;
 *  the first section when none has scrolled past it. */
export function activeSection(tops: Record<string, number>, line = 140, sections: readonly VolumeSection[] = VOLUME_SECTIONS): string {
  let current = sections[0]?.id ?? "";
  let best = -Infinity;
  for (const { id } of sections) {
    const top = tops[id];
    if (typeof top === "number" && top <= line && top > best) { best = top; current = id; }
  }
  return current;
}

export type SourceCheck = { label: string; status: "ok" | "info" | "warn"; detail: string };

/** Checklist built only from what the saved run records; nothing is asserted that was not stored. */
export function sourceChecklist(run: {
  input_kind: string; source_shape: number[]; preprocessing?: { version?: string; roi?: { fov_mm: number } | null };
  hasSourceGridMask: boolean; validation?: { status: string; detail: string };
}): SourceCheck[] {
  return [
    { label: "Source type", status: run.input_kind === "medical_study" ? "ok" : "warn",
      detail: run.input_kind === "medical_study" ? "Medical study, confirmed as original Hounsfield-unit CT and research-only at upload"
        : run.input_kind === "synthetic_fixture" ? "Synthetic geometry test, not a medical image" : "Source provenance unspecified (legacy run)" },
    { label: "Volume geometry", status: run.source_shape.length === 3 ? "ok" : "warn",
      detail: run.source_shape.length === 3 ? `${run.source_shape.join(" × ")} voxels read from the saved source` : "Shape not recorded" },
    { label: "Saved source validation", status: run.validation?.status === "checked" ? "ok" : run.validation?.status === "failed" ? "warn" : "info",
      detail: run.validation?.detail ?? "Checking saved source geometry. Original DICOM-series identity is a separate acquisition check." },
    { label: "Model input preparation", status: run.preprocessing?.version ? "ok" : "info",
      detail: [run.preprocessing?.version ? `Preprocessing ${run.preprocessing.version}` : "Preprocessing version not recorded",
        run.preprocessing?.roi ? `heart-centred ${run.preprocessing.roi.fov_mm} mm field of view` : "full volume"].join(" · ") },
    { label: "Mask mapped to source grid", status: run.hasSourceGridMask ? "ok" : "warn",
      detail: run.hasSourceGridMask ? "Predicted mask saved on the original volume grid (NIfTI)" : "Source-grid mask not available" },
  ];
}
