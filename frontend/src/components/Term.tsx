import { glossaryHint } from "../glossary";

/** A metric or concept name with its plain-language definition available on hover and focus. */
export default function Term({ name, children }: { name: string; children?: React.ReactNode }) {
  const hint = glossaryHint(name);
  if (!hint) return <>{children ?? name}</>;
  return <abbr className="cv-term" title={hint} tabIndex={0}>{children ?? name}</abbr>;
}
