import { useEffect, useRef } from 'react';
import { candidateLabel, pathLabel } from './lib/candidateNavigation';
import VolumeOrbit, { type SurfaceSite } from './VolumeOrbit';
import type { GeometryPath } from './VolumeCprReview';
import type { VolumeCandidate } from './VolumeCandidateList';

export type LumenSection = {
  grid_size: number;
  step_mm: number;
  lumen_pixels_ij: number[][];
  center_ras_mm: number[];
  area_mm2: number;
  equivalent_diameter_mm: number;
};


function SectionImage({ section, title }: { section: LumenSection; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(section.grid_size, section.grid_size);
    for (const [i, j] of section.lumen_pixels_ij) {
      const offset = (j * section.grid_size + i) * 4;
      pixels.data[offset] = 35;
      pixels.data[offset + 1] = 210;
      pixels.data[offset + 2] = 180;
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const occupied = new Set(section.lumen_pixels_ij.map(([i, j]) => `${i},${j}`));
    context.strokeStyle = '#ffffff'; context.lineWidth = .35;
    for (const [i, j] of section.lumen_pixels_ij) {
      for (const [di, dj, x1, y1, x2, y2] of [[-1,0,i,j,i,j+1],[1,0,i+1,j,i+1,j+1],[0,-1,i,j,i+1,j],[0,1,i,j+1,i+1,j+1]]) {
        if (!occupied.has(`${i+di},${j+dj}`)) { context.beginPath(); context.moveTo(x1,y1); context.lineTo(x2,y2); context.stroke(); }
      }
    }
    const mid = (section.grid_size - 1) / 2;
    context.strokeStyle = '#fb923c'; context.lineWidth = .65;
    context.beginPath(); context.moveTo(mid-2,mid); context.lineTo(mid+2,mid); context.moveTo(mid,mid-2); context.lineTo(mid,mid+2); context.stroke();
  }, [section]);
  const fieldMm = section.grid_size * section.step_mm;
  const scaleMm = Math.min(5, Math.floor(fieldMm / 2));
  return <figure className="lumen-section-card">
    <figcaption><strong>{title}</strong><span>Predicted-mask cross-section</span></figcaption>
    <div className="lumen-section-image"><canvas ref={canvas} width={section.grid_size} height={section.grid_size}
      role="img" aria-label={`${title}: predicted lumen mask, ${fieldMm.toFixed(1)} mm field of view`} />
      <span className="lumen-scale" style={{ width: `${scaleMm / fieldMm * 100}%` }}>{scaleMm} mm</span>
    </div>
    <svg viewBox="0 0 160 42" className="equivalent-diameter-key" role="img" aria-label={`Equivalent-area circle diameter ${section.equivalent_diameter_mm.toFixed(2)} mm; schematic, not a measured anatomical chord`}><circle cx="25" cy="21" r="16" fill="none" stroke="currentColor"/><path d="M9 21H41 M9 17V25 M41 17V25" stroke="currentColor"/><text x="50" y="25" fill="currentColor" fontSize="12">Ø {section.equivalent_diameter_mm.toFixed(2)} mm</text></svg>
    <p className="caption">White: mask boundary · orange: sampling centre. Diameter symbol: equivalent-area circle schematic.</p>
    <dl className="lumen-section-values"><div><dt>Equivalent diameter</dt><dd>{section.equivalent_diameter_mm.toFixed(2)} mm</dd></div><div><dt>Lumen area</dt><dd>{section.area_mm2.toFixed(2)} mm²</dd></div></dl>
    <details><summary>Sampling and position</summary><p>Field: {fieldMm.toFixed(1)} × {fieldMm.toFixed(1)} mm. Grid step: {section.step_mm} mm.</p><p>Centre RAS: {section.center_ras_mm.map(value => value.toFixed(2)).join(', ')} mm.</p></details>
  </figure>;
}

const SECTION_TITLES = ['Minimum section', 'Reference 1 · proximal', 'Reference 2 · distal'];
const SITE_COLORS = ['#fbbf24', '#67e8f9', '#c4b5fd'];

export default function VolumeMeasurementPanel({ candidates, selectedId, onSelect, previewUrl, token, paths }: {
  candidates: VolumeCandidate[];
  selectedId?: string;
  onSelect: (id: string) => void;
  previewUrl?: string | null;
  token: string;
  paths?: GeometryPath[];
}) {
  const selected = candidates.find(candidate => candidate.id === selectedId) ?? candidates[0];
  if (!selected) return null;
  const path = paths?.find(item => item.id === selected.path_id);
  const sites: SurfaceSite[] = (selected.cross_sections ?? []).slice(0, 3).flatMap((section, index) => {
    const [x, y, z] = section.center_ras_mm;
    return [x, y, z].every(Number.isFinite) ? [{position: [x, y, z], label: String(index + 1), color: SITE_COLORS[index]}] : [];
  });
  return <section className="lumen-comparison" aria-label="Candidate cross-section comparison">
    <h4>Perpendicular lumen sections</h4>
    <p className="caption">These panels show the predicted binary mask, not CT images or expert annotations; cyan marks predicted lumen.</p>
    <label>Geometry candidate <select value={selected.id} onChange={event => onSelect(event.target.value)}>
      {candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidateLabel(candidate.id)} — {pathLabel(candidate.path_id)}</option>)}
    </select></label>
    <div className="candidate-measurement-summary" aria-label="Selected candidate measurement summary">
      <div className="candidate-measurement-heading"><div><h5>{candidateLabel(selected.id)} — {pathLabel(selected.path_id)}</h5><p>Experimental mask geometry · artery not established</p></div><span className="measurement-review-badge">Review required</span></div>
      <dl className="reference-metric-grid measurement-primary-metrics">
        <div><dt>Minimum diameter</dt><dd>{selected.minimum_diameter_mm.toFixed(2)} mm</dd></div>
        <div><dt>Mean reference diameter</dt><dd>{selected.reference_diameter_mm.toFixed(2)} mm</dd></div>
        <div><dt>Diameter narrowing</dt><dd>{selected.narrowing_percent.toFixed(2)}%</dd></div>
        <div><dt>Area narrowing</dt><dd>{selected.area_narrowing_percent?.toFixed(2) ?? 'Not recorded'}{selected.area_narrowing_percent != null ? '%' : ''}</dd></div>
      </dl>
      <p className="measurement-grade">Research grade: <strong>{selected.severity ?? 'Withheld'}</strong> · experimental, not independently validated.</p>
      <details><summary>Quality, areas, sensitivity and technical details</summary>
        <dl className="measurement-secondary-metrics"><div><dt>Minimum area</dt><dd>{selected.minimum_area_mm2?.toFixed(2) ?? 'Not recorded'}{selected.minimum_area_mm2 != null ? ' mm²' : ''}</dd></div><div><dt>Mean reference area</dt><dd>{selected.reference_area_mm2?.toFixed(2) ?? 'Not recorded'}{selected.reference_area_mm2 != null ? ' mm²' : ''}</dd></div></dl>
        <p>Diameter is derived from section area: 2 × √(area / π), not a caliper chord. Sampling-grid sensitivity does not capture total model or clinical uncertainty.</p>
        {selected.sensitivity?.values?.map(value => <p key={value.step_mm}>{value.step_mm} mm grid: {value.narrowing_percent.toFixed(2)}% narrowing</p>)}
        {!selected.sensitivity?.values?.length && <p>Sampling sensitivity not recorded for this result.</p>}
        {selected.abstention_reasons?.map(reason => <p key={reason}>{reason.replaceAll('_',' ')}</p>)}
        <p>Saved IDs: {selected.id} / {selected.path_id}. RAS: {selected.location_ras_mm.map(value => value.toFixed(2)).join(', ')} mm.</p>
      </details>
    </div>
    {previewUrl && sites.length > 0 && <section className="measurement-surface measurement-surface-primary" aria-label="3D measurement locations">
      <div className="measurement-surface-heading">
        <div><h5>3D measurement locations</h5></div>
        <ul className="measurement-site-legend" aria-label="Measurement marker legend">{sites.map(site => <li key={site.label}><span style={{borderColor: site.color}}>{site.label}</span>{SECTION_TITLES[Number(site.label) - 1]}</li>)}</ul>
      </div>
      <VolumeOrbit key={previewUrl} url={previewUrl} token={token} selectedPath={path?.points_ras_mm} sites={sites} />
    </section>}
    {selected.cross_sections?.length ? <details className="lumen-section-details">
      <summary>View 2D cross-sections and exact section values</summary>
      <p className="caption">These supporting panels show the predicted binary mask at the three numbered 3D locations, not CT images or expert annotations.</p>
      <div className="lumen-section-grid">
        {selected.cross_sections.map((section, index) => <SectionImage key={`${selected.id}-${index}`} section={section}
          title={SECTION_TITLES[index] ?? `Section ${index + 1}`} />)}
      </div>
    </details> : null}
    {!selected.cross_sections?.length && <p>Cross-section images were not saved for this run. The saved candidate diameters are shown below.</p>}
    <p className="caption">The reference diameter is the mean of the two reference-section equivalent diameters. Diameter narrowing = max(0, 1 − minimum / reference) × 100. A sampled reference can be smaller than the candidate minimum; this is not independently confirmed lesion anatomy.</p>
    <p>Minimum lumen {selected.minimum_diameter_mm.toFixed(2)} mm · reference lumen {selected.reference_diameter_mm.toFixed(2)} mm</p>
    <p className="volume-measurement-result"><strong>{selected.narrowing_percent.toFixed(2)}% narrowing</strong><span>{selected.severity ?? 'Grade withheld'} · experimental</span></p>
  </section>;
}
