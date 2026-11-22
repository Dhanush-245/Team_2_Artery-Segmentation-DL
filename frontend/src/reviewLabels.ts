/** Actor-specific form labels; historical author identities are never relabelled. */
export function reviewLabels(role?: string) {
  const name = role === "clinician" ? "Clinician" : role === "doctor" ? "Doctor" : "Reviewer";
  return {
    title: `${name} review and decision`,
    decision: `${name}’s decision`,
    severity: `${name}-assessed stenosis severity (optional)`,
    notes: `${name}’s review notes`,
    submit: `Record ${name.toLowerCase()} review`,
  };
}
