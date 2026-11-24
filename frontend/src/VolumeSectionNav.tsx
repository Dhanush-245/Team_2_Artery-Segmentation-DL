import { useEffect, useRef, useState } from "react";
import { VOLUME_SECTIONS, activeSection, sourceChecklist, type SourceCheck } from "./lib/volumeSections";

export function VolumeSectionNav() {
  const [active, setActive] = useState(VOLUME_SECTIONS[0].id);
  const pinned = useRef<string | null>(null); // a clicked section near the page end cannot scroll to the top
  useEffect(() => {
    const update = () => {
      const tops: Record<string, number> = {};
      for (const { id } of VOLUME_SECTIONS) {
        const element = document.getElementById(id);
        if (element) tops[id] = element.getBoundingClientRect().top;
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setActive(atEnd && pinned.current ? pinned.current : activeSection(tops));
    };
    update();
    const release = () => { pinned.current = null; };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("wheel", release); window.removeEventListener("touchmove", release); };
  }, []);
  return <nav className="v3d-nav" aria-label="3D case sections">
    {VOLUME_SECTIONS.map(({ id, label }) => <a key={id} href={`#${id}`} aria-current={active === id ? "true" : undefined}
      onClick={event => { event.preventDefault(); pinned.current = id; document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{label}</a>)}
  </nav>;
}

export function VolumeSourcePanel(props: Parameters<typeof sourceChecklist>[0]) {
  const checks: SourceCheck[] = sourceChecklist(props);
  return <section id="v3d-source" className="v3d-block" aria-label="Source and preprocessing">
    <p className="eyebrow">SOURCE &amp; PREPROCESSING</p><h4>Source validation checklist</h4>
    <ul className="v3d-checks">{checks.map(check => <li key={check.label}><span className={`cv-chip ${check.status === "ok" ? "ok" : check.status === "warn" ? "warn" : "info"}`}>{check.status === "ok" ? "Checked" : check.status === "warn" ? "Review" : "Rule"}</span>
      <div><strong>{check.label}</strong><small>{check.detail}</small></div></li>)}</ul>
  </section>;
}

export function VolumeEvaluationPanel({ modelId }: { modelId: string }) {
  return <section id="v3d-evaluation" className="v3d-block" aria-label="Model evaluation">
    <p className="eyebrow">MODEL EVALUATION</p><h4>What this run can and cannot report</h4>
    <dl className="volume-summary-grid">
      <div><dt>Model</dt><dd>{modelId}</dd></div>
      <div><dt>Case-level Dice, IoU, HD95</dt><dd>Unavailable: no reference mask is attached to this run</dd></div>
      <div><dt>Aggregate benchmark</dt><dd>Retained 3D U-Net validation Dice 0.7937 on 150 prepared ImageCAS volumes (development evidence, not this case&apos;s accuracy)</dd></div>
    </dl>
    <p className="caption">Open Model Evaluation for the architecture comparison. Benchmarks describe the model on a validation cohort; they are never shown as a score for an individual new scan.</p>
  </section>;
}

export function VolumeReviewPanel({ runs, selectedId }: { runs: { id: string; created_at: string; status: string; model_id: string }[]; selectedId: string }) {
  return <section id="v3d-review" className="v3d-block" aria-label="Review and history">
    <p className="eyebrow">REVIEW &amp; HISTORY</p><h4>Saved runs for this case</h4>
    <div className="table-scroll"><table className="stenosis-summary"><thead><tr><th>Run</th><th>Date</th><th>Status</th><th>Model</th></tr></thead>
      <tbody>{runs.map(run => <tr key={run.id} aria-current={run.id === selectedId ? "true" : undefined}><td>{run.id.slice(0, 8)}{run.id === selectedId ? " (open)" : ""}</td><td>{run.created_at}</td><td>{run.status}</td><td>{run.model_id}</td></tr>)}</tbody></table></div>
    <p className="caption">Reviewer measurement edits made in the curved reformation are saved as separate versions with the reviewer and time; the original model mask and earlier exported reports are never overwritten. Use the run selector at the top to reopen any earlier run.</p>
  </section>;
}
