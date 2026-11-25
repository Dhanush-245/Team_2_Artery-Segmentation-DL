import { apiUrl } from "./api";
import { useEffect, useRef, useState } from "react";
import { VOLUME_SECTIONS, activeSection, sourceChecklist, type SourceCheck } from "./lib/volumeSections";

export function VolumeSectionNav() {
  const [active, setActive] = useState(VOLUME_SECTIONS[0].id);
  const pinned = useRef<string | null>(null); // Keep explicit selection until the user scrolls manually.
  useEffect(() => {
    const update = () => {
      const tops: Record<string, number> = {};
      for (const { id } of VOLUME_SECTIONS) {
        const element = document.getElementById(id);
        if (element) tops[id] = element.getBoundingClientRect().top;
      }
      setActive(pinned.current ?? activeSection(tops));
    };
    update();
    const release = () => { pinned.current = null; };
    document.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    const keyRelease = (event: KeyboardEvent) => { if (["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) release(); };
    window.addEventListener("keydown", keyRelease);
    return () => { document.removeEventListener("scroll", update, true); window.removeEventListener("wheel", release); window.removeEventListener("touchmove", release); window.removeEventListener("keydown", keyRelease); };
  }, []);
  return <nav className="v3d-nav" aria-label="3D case sections">
    {VOLUME_SECTIONS.map(({ id, label }) => <a key={id} href={`#${id}`} aria-current={active === id ? "true" : undefined}
      onClick={event => { event.preventDefault();
        const target = document.getElementById(id);
        if (!target) return;
        for (let parent = target.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
        pinned.current = id; setActive(id);
        target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }}>{label}</a>)}
  </nav>;
}

export function VolumeSourcePanel(props: Parameters<typeof sourceChecklist>[0] & { caseId: string; runId: string; token: string }) {
  const [validation, setValidation] = useState<{ status: string; detail: string }>();
  useEffect(() => {
    const controller = new AbortController();
    setValidation(undefined);
    void fetch(apiUrl(`/api/cases/${props.caseId}/volumes/analyses/${props.runId}/source-validation`),
      { headers: { Authorization: `Bearer ${props.token}` }, signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Saved-source validation failed'); return body; })
      .then(setValidation).catch(error => { if (!controller.signal.aborted) setValidation({ status: 'failed', detail: error.message }); });
    return () => controller.abort();
  }, [props.caseId, props.runId, props.token]);
  const checks: SourceCheck[] = sourceChecklist({ ...props, validation });
  return <section id="v3d-source" className="v3d-block" aria-label="Source and preprocessing">
    <p className="eyebrow">SOURCE &amp; PREPROCESSING</p><h4>Source validation checklist</h4>
    <ul className="v3d-checks">{checks.map(check => <li key={check.label}><span className={`cv-chip ${check.status === "ok" ? "ok" : check.status === "warn" ? "warn" : "info"}`}>{check.status === "ok" ? "Checked" : check.status === "warn" ? "Review" : "Rule"}</span>
      <div><strong>{check.label}</strong><small>{check.detail}</small></div></li>)}</ul>
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
