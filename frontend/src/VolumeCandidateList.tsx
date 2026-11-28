import type { LumenSection } from './VolumeMeasurementPanel';
import { candidateLabel, pathLabel } from './lib/candidateNavigation';
export type VolumeCandidate = {
  id: string; path_id: string; minimum_diameter_mm: number; reference_diameter_mm: number;
  minimum_area_mm2?: number; reference_area_mm2?: number; area_narrowing_percent?: number;
  narrowing_percent: number; severity: string | null; location_ras_mm: number[];
  sensitivity?: { narrowing_percent_range?: number[]; values?: { step_mm: number; narrowing_percent: number }[] };
  abstention_reasons?: string[]; cross_sections?: LumenSection[];
};
export default function VolumeCandidateList({ candidates, selectedId, onSelect }: { candidates: VolumeCandidate[]; selectedId?: string; onSelect: (candidate: VolumeCandidate) => void }) {
  return <div className="candidate-picker" aria-label="Select a geometry candidate">
    <p className="caption">Select a candidate to locate it in all four views. Expert acceptance and artery identity are not established.</p>
    <div className="candidate-card-grid">{candidates.map(candidate => <button type="button" key={candidate.id} aria-pressed={selectedId === candidate.id} className={`candidate-choice${selectedId === candidate.id ? ' active' : ''}`} onClick={() => onSelect(candidate)}>
      <strong>{candidateLabel(candidate.id)} — {pathLabel(candidate.path_id)}</strong>
      <span>{candidate.narrowing_percent.toFixed(1)}% diameter narrowing</span>
      <span>{candidate.severity ? `${candidate.severity} · experimental` : 'Grade withheld'}</span>
      <span className="research-tag">Geometry eligible · review required</span>
      <span>View in MPR + 3D →</span>
    </button>)}</div>
  </div>;
}
