export type RegistrationResult = {
  image_id: string; reference_id: string; mode: "rigid" | "affine";
  success: boolean; reason: string | null; method: string;
  ncc_before: number; ncc_after: number; improvement: number; low_confidence: boolean;
  parameters: { translation_x_px: number; translation_y_px: number; rotation_deg: number; scale_x: number; scale_y: number };
  moving_resized_to_reference: boolean;
  overlay_urls: { blend: string; checker: string; aligned: string };
  note: string;
};

export const VIEW_LABELS = { blend: "Blend (red reference, green aligned)", checker: "Checkerboard", aligned: "Aligned frame only" } as const;
export type RegistrationView = keyof typeof VIEW_LABELS;

/** Plain-language lines for the transform that brings the selected frame onto the reference. */
export function describeTransform(result: Pick<RegistrationResult, "parameters" | "mode">): string[] {
  const { translation_x_px: x, translation_y_px: y, rotation_deg: rotation, scale_x: sx, scale_y: sy } = result.parameters;
  const direction = (value: number, positive: string, negative: string) => (value === 0 ? "none" : `${Math.abs(value).toFixed(1)} px ${value > 0 ? positive : negative}`);
  const lines = [
    `Shift: ${direction(x, "right", "left")}, ${direction(y, "down", "up")}`,
    `Rotation: ${Math.abs(rotation) < 0.05 ? "none" : `${Math.abs(rotation).toFixed(2)}° ${rotation > 0 ? "counter-clockwise" : "clockwise"}`}`,
  ];
  if (result.mode === "affine") lines.push(`Scale: ${sx.toFixed(3)} horizontal, ${sy.toFixed(3)} vertical`);
  return lines;
}

/** One sentence that says whether the alignment can be trusted. */
export function summarize(result: RegistrationResult): { label: string; tone: "good" | "warn" | "none" } {
  if (!result.success) return { label: result.reason ?? "The frames could not be aligned.", tone: "none" };
  if (result.low_confidence) return { label: "Aligned, but the agreement is low. Check the overlay before relying on it.", tone: "warn" };
  return { label: `Aligned: image agreement rose from ${result.ncc_before.toFixed(2)} to ${result.ncc_after.toFixed(2)}.`, tone: "good" };
}
