export type ScreeningLabel = "abnormal_flagged" | "not_flagged" | "indeterminate";

export type Screening = {
  label: ScreeningLabel; display: string; reasons: string[]; limitations: string;
  basis: { rule: string; threshold: number; candidates: number; flagged_candidates: string[]; max_score: number };
};

/** Colour group for the badge. Not flagged is deliberately neutral: it never reads as "normal" or "safe". */
export function screeningTone(label: ScreeningLabel | undefined): "flag" | "neutral" | "unsure" {
  if (label === "abnormal_flagged") return "flag";
  if (label === "indeterminate") return "unsure";
  return "neutral";
}

export function screeningCounts(distribution: Partial<Record<ScreeningLabel, number>> | undefined) {
  return { flagged: distribution?.abnormal_flagged ?? 0, notFlagged: distribution?.not_flagged ?? 0, indeterminate: distribution?.indeterminate ?? 0 };
}
