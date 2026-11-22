import { GLOSSARY } from "../glossary";

/** Collapsible glossary of the terms used across evaluation, analysis and 3D screens. */
export default function GlossaryPanel({ terms }: { terms?: string[] }) {
  const entries = Object.entries(GLOSSARY).filter(([name]) => !terms || terms.includes(name));
  return (
    <details className="cv-glossary">
      <summary>Glossary of terms</summary>
      <dl>{entries.map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}</dl>
    </details>
  );
}
