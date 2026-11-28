import { Link } from "react-router-dom";
import { readViewerSession, saveViewerSession } from "./lib/viewerSession";
import VolumeCandidateList, { type VolumeCandidate } from './VolumeCandidateList';
import { candidateLabel } from './lib/candidateNavigation';
import VolumeReports from './VolumeReports';
import VolumeReferenceMetrics from './VolumeReferenceMetrics';
import { useCallback, useEffect, useState } from 'react';
import { Download, FileJson } from 'lucide-react';
import { apiUrl } from './api';
import { Button } from './components/prismui/button';
import VolumeMeasurementPanel from './VolumeMeasurementPanel';
import VolumeMprViewer from './VolumeMprViewer';
import VolumeLinkedViewer, { type ViewTarget } from './VolumeLinkedViewer';
import VolumeMaskReviewPanel from './VolumeMaskReviewPanel';
import VolumeXaiPanel from './VolumeXaiPanel';
import VolumeCprReview, { type GeometryPath } from './VolumeCprReview';
import { utcDate } from "./lib/time";
import { AnalysisSectionNav, VolumeSourcePanel, VolumeReviewPanel } from './VolumeSectionNav';

type VolumeRun = { id: string; status: string; error: string | null; created_at: string;model_key?:string;
  input_kind: 'medical_study' | 'synthetic_fixture' | 'unspecified';
  preview_url?: string | null; artifacts: Record<string,string>; result: null | { model_id: string; duration_seconds: number;
    preprocessing?: { version?: string; roi?: { fov_mm: number } | null };
    postprocessing?: { method: string; max_median_distance_mm: number; removed_voxels: number; components: { component: number; voxels: number; median_distance_mm: number; kept: boolean }[] } | null;
  coarse_foreground_voxels: number; source_shape: number[]; limitations: string[];
  slices: { axis: string; coarse_index: number; artifact: string }[] } };

type ExploratoryEstimate = { path_id: string; component_id: number; length_mm: number; minimum_diameter_mm: number; reference_diameter_mm: number;
  narrowing_percent: number; research_band: string; eligible_candidate: string | null; withheld_reason: string | null; location_ras_mm: number[] };
const BAND_LABEL: Record<string, string> = { none: 'No narrowing', minimal: 'Minimal', mild: 'Mild', moderate: 'Moderate', severe: 'Severe' };

type Props = {caseId: string; token: string; readOnly?: boolean; anatomy?: string; historyOnly?: boolean; intakeOnly?: boolean; onOpenAnalysis?: () => void};

export default function VolumeInference(props: Props) {
  return <VolumeCase key={`${props.caseId}:${props.token}`} {...props} />;
}

function VolumeCase({caseId, token, readOnly = false, anatomy = 'coronary', historyOnly = false, intakeOnly = false, onOpenAnalysis}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dicomFiles, setDicomFiles] = useState<File[]>([]);
  const [hu, setHu] = useState(false);
  const [research, setResearch] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [limits, setLimits] = useState({max_file_bytes:384*1024*1024, max_source_voxels:96_000_000});
  const [runs, setRuns] = useState<VolumeRun[]>([]);
  const [chosen, setChosen] = useState(() => readViewerSession(caseId + '.run', ''));
  const [crosshair, setCrosshair] = useState<[number, number, number] | null>(null);
  const [maskVersion, setMaskVersion] = useState<number | null>(null);
  const [viewTarget, setViewTarget] = useState<ViewTarget | null>(null);
  const [candidateId, setCandidateId] = useState('');
  const [focusPath, setFocusPath] = useState<{ id: string; nonce: number } | null>(null);
  const focusLocation = (ras: number[], label: string, pathId: string, scroll = true) => {
    const nonce = Date.now();
    setViewTarget({ ras: [ras[0], ras[1], ras[2]], label, nonce, scroll }); setFocusPath({ id: pathId, nonce });
  };
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState<Record<string,string>>({});
  const [report, setReport] = useState<null | {experimental_geometry?: {status?:string;reasons?:string[];exploratory_estimates?:ExploratoryEstimate[];mask_sha256?:string;paths?: GeometryPath[];candidates?:VolumeCandidate[];limitations?:string[]}; analysis_run_id:string; model_id:string; explanation:{text:string}; stages:Record<string,{status:string;reason:string}>}>(null);
  const [reportError,setReportError] = useState('');
  const [reportVersion, setReportVersion] = useState(0);
  const reloadReport = useCallback(() => setReportVersion(value => value + 1), []);
  const [heat, setHeat] = useState<{ id?: string; label?: string }>({});
  const showHeat = useCallback((id?: string, label?: string) => setHeat({ id, label }), []);
  const selected = runs.find(r => r.id === chosen) || runs[0];
  useEffect(() => {
    const runId = selected?.id;
    setCandidateId(runId ? readViewerSession(caseId + '.' + runId + '.candidate', '') : '');
    setViewTarget(null);
    setFocusPath(null);
    if (runId) saveViewerSession(caseId + '.run', runId);
  }, [caseId, selected?.id]);
  const active = runs.some(r => ['queued','running'].includes(r.status));
  const headers = {Authorization: `Bearer ${token}`};

  useEffect(() => { setReport(null); setReportError(''); }, [caseId, selected?.id, selected?.status, token]);
  useEffect(() => {
    let disposed=false;
    if (!intakeOnly && !historyOnly && selected?.status === 'completed') void fetch(apiUrl(`/api/cases/${caseId}/volumes/analyses/${selected.id}/analysis-detail`),
      {headers:{Authorization:`Bearer ${token}`}}).then(async response=>{
        if(!response.ok) throw new Error('Saved 3D explanation/report unavailable for this account or run.');
        return response.json();
      }).then(value=>{if(!disposed)setReport(value);}).catch(cause=>{if(!disposed)setReportError(cause.message);});
    return ()=>{disposed=true;};
  },[caseId,selected?.id,selected?.status,token,reportVersion,intakeOnly,historyOnly]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(apiUrl(`/api/cases/${caseId}/volumes/analyses`), {headers: {Authorization:`Bearer ${token}`}});
        if (!response.ok) throw new Error('Unable to load saved 3D analyses');
        const rows: VolumeRun[] = await response.json();
        if (!disposed) setRuns(rows);
      } catch (cause) { if (!disposed) setError((cause as Error).message); }
      if (!disposed) timer = setTimeout(refresh, active ? 2000 : 10000);
    }
    void refresh();
    void fetch(apiUrl('/api/volume-models'), {headers: {Authorization:`Bearer ${token}`}})
      .then(async r => { if (!r.ok) throw new Error('Model status unavailable'); return r.json(); })
      .then(rows => { if (!disposed) { const chosen=rows.find((r:{model_key:string})=>r.model_key===(anatomy==='aorta'?'aorta_aligned':'imagecas'));if(chosen){setInstalled(Boolean(chosen.installed));setLimits(chosen.limits);}else setInstalled(false); } })
      .catch(cause => { if (!disposed) setError(cause.message); });
    return () => { disposed = true; clearTimeout(timer); };
  }, [caseId, token, active, busy,anatomy]);

  useEffect(() => {
    let disposed = false;
    const urls: string[] = [];
    setPreviews({});
    if (!intakeOnly && !historyOnly && selected?.status === 'completed') {
      void Promise.all((selected.result?.slices || []).map(async slice => {
        const response = await fetch(apiUrl(selected.artifacts[slice.artifact]), {headers: {Authorization:`Bearer ${token}`}});
        if (!response.ok) throw new Error('Saved slice preview unavailable');
        const url = URL.createObjectURL(await response.blob()); urls.push(url);
        if (disposed) { URL.revokeObjectURL(url); return; }
        setPreviews(previous => ({...previous, [slice.artifact]:url}));
      })).catch(cause => { if (!disposed) setError(cause.message); });
    }
    return () => { disposed = true; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [selected?.id, selected?.status, token, intakeOnly, historyOnly]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if ((!file && !dicomFiles.length) || busy) return;
    setBusy(true); setError(''); setUploadPercent(0);
    try {
      if (!dicomFiles.length && (!file || !/\.(nii(\.gz)?|zip)$/i.test(file.name) || !file.size || file.size > limits.max_file_bytes))
        throw new Error(`Choose an intact .nii, .nii.gz or single-series DICOM .zip file between 1 byte and ${Math.floor(limits.max_file_bytes/1024/1024)} MiB`);
      const body = new FormData();
      if (dicomFiles.length) {
        if (dicomFiles.length < 2 || dicomFiles.length > 2000 || dicomFiles.some(f => !f.size || f.size > 64*1024*1024) || dicomFiles.reduce((s,f)=>s+f.size,0) > limits.max_file_bytes)
          throw new Error('Select 2-2000 non-empty DICOM slices within the volume upload limit.');
        dicomFiles.forEach(f => body.append('files',f));
      } else if (file) body.append('file',file);
      body.append('hu_confirmed',String(hu)); body.append('research_confirmed',String(research)); body.append('input_kind','medical_study');
      const row = await new Promise<VolumeRun>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', apiUrl(`/api/cases/${caseId}/volumes/${dicomFiles.length ? 'dicom-analyses' : 'analyses'}`));
        request.setRequestHeader('Authorization', headers.Authorization);
        request.timeout = 300000;
        request.upload.onprogress = event => setUploadPercent(event.lengthComputable ? Math.round(event.loaded / event.total * 100) : null);
        request.onerror = () => reject(new Error('Upload connection failed. Check saved analysis history before retrying.'));
        request.ontimeout = () => reject(new Error('Upload timed out. Check saved analysis history before retrying.'));
        request.onload = () => {
          try {
            const result = JSON.parse(request.responseText);
            if (request.status < 200 || request.status >= 300)
              throw new Error(typeof result.detail === 'string' ? result.detail : '3D inference rejected');
            resolve(result);
          } catch (cause) { reject(cause); }
        };
        request.send(body);
      });
      setRuns(previous => [row,...previous]); setChosen(row.id);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); setUploadPercent(null); }
  }

  async function download(name: string) {
    if (!selected) return;
    try {
      const endpoint = selected.artifacts[name];
      const response = await fetch(apiUrl(endpoint), {headers});
      if (!response.ok) throw new Error('Artifact unavailable or access expired');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url),30000);
    } catch (cause) { setError((cause as Error).message); }
  }

  const geometry = report?.experimental_geometry;
  const candidates = geometry?.candidates ?? [];
  const selectedCandidate = candidates.find(candidate => candidate.id === candidateId) ?? candidates[0];
  const selectCandidate = (candidate: VolumeCandidate, scroll = true) => {
    setCandidateId(candidate.id);
    if (selected) saveViewerSession(caseId + "." + selected.id + ".candidate", candidate.id);
    focusLocation(candidate.location_ras_mm, `${candidateLabel(candidate.id)} — suspected narrowing`, candidate.path_id, scroll);
  };
  const activePath = geometry?.paths?.find(path => path.id === (focusPath?.id ?? selectedCandidate?.path_id));
  useEffect(() => {
    const candidate = report?.analysis_run_id === selected?.id ? report?.experimental_geometry?.candidates?.[0] : undefined;
    if (candidate && !candidateId) {
      setCandidateId(candidate.id);
      saveViewerSession(caseId + "." + selected?.id + ".candidate", candidate.id);
      focusLocation(candidate.location_ras_mm, `${candidateLabel(candidate.id)} — suspected narrowing`, candidate.path_id, false);
    }
  }, [report, candidateId, selected?.id]); // saved coordinates only, no new inference
  useEffect(() => {
    if (selectedCandidate && !focusPath) {
      focusLocation(selectedCandidate.location_ras_mm, `${candidateLabel(selectedCandidate.id)} — suspected narrowing`, selectedCandidate.path_id, false);
    }
  }, [selectedCandidate?.id, focusPath, selected?.id]); // initialize the linked path from a restored candidate
  const primaryCandidate = candidates[0];
  const estimates = geometry?.exploratory_estimates ?? [];
  const topEstimate = estimates[0];
  const geometryReason = geometry?.reasons?.[0]?.replaceAll('_',' ') ?? '';

  if (historyOnly) return <section className="volume-inference" aria-label="3D analysis history">
    <h3>3D analysis history</h3>
    {error && <p role="alert">{error}</p>}
    {!runs.length ? <p className="muted">No saved volume analyses yet. Upload a NIfTI or DICOM series in Upload or prepare a volume, then run 3D analysis.</p> : <table className="stenosis-summary">
      <thead><tr><th>Date</th><th>Run</th><th>Status</th><th>Model</th><th>Duration</th></tr></thead>
      <tbody>{runs.map(run => <tr key={run.id}><td>{utcDate(run.created_at).toLocaleString()}</td><td>{run.id}</td><td>{run.status}</td><td>{run.result?.model_id ?? run.model_key ?? 'Unavailable'}</td><td>{run.result ? `${run.result.duration_seconds.toFixed(2)} s` : 'Unavailable'}</td></tr>)}</tbody>
    </table>}
    {onOpenAnalysis && <Button variant="outline" size="sm" onClick={onOpenAnalysis}>Open analysis viewer</Button>}
  </section>;
  return <section className="volume-inference" aria-labelledby="volume-inference-title">
    <header className="cv-panel-head"><p className="eyebrow">{intakeOnly ? "VOLUME UPLOAD" : "VOLUME ANALYSIS"}</p><h3 id="volume-inference-title">{anatomy==='aorta'?'Aortic CT':'Coronary CTA'} segmentation</h3></header>
    {!readOnly && <form onSubmit={start} className="volume-run-form" aria-busy={busy}>
      <label>Original de-identified {anatomy==='aorta'?'CT/CTA':'coronary CTA'} volume<input type="file" accept=".nii,.nii.gz,.zip" required={!dicomFiles.length} disabled={busy} aria-describedby={error ? 'volume-input-help volume-error' : 'volume-input-help'} onChange={e => { setFile(e.target.files?.[0] || null); setError(''); }} /></label>
      <p id="volume-input-help">NIfTI or a ZIP containing exactly one de-identified CT DICOM series · up to {Math.floor(limits.max_file_bytes/1024/1024)} MiB and {(limits.max_source_voxels/1_000_000).toFixed(0)} million native voxels. DICOM reconstruction checks series identity, slice ordering, orientation and spacing before inference. NIfTI headers must specify millimetres. JPEG/PNG images and 4D sequences are not 3D CT volumes.</p>
      <label className="volume-confirm"><input type="checkbox" checked={hu} onChange={e => setHu(e.target.checked)} required />I confirm original Hounsfield-unit CT intensities, not a normalized or enhanced export.</label>
      <label className="volume-confirm"><input type="checkbox" checked={research} onChange={e => setResearch(e.target.checked)} required />I confirm de-identification and research-only use; this model is not clinically validated.</label>
      <label>Or select a complete DICOM series<input type="file" multiple accept=".dcm,.dicom" disabled={busy} onChange={e => {setDicomFiles(Array.from(e.target.files || [])); setError('');}} /></label>
      {dicomFiles.length > 0 && <p role="status">{dicomFiles.length} slices selected · {(dicomFiles.reduce((sum,f)=>sum+f.size,0)/1024/1024).toFixed(1)} MiB. These slices take precedence over the single-file input. Select exactly one study and series; mixed series are rejected.</p>}
      {busy && <div role="status"><progress aria-label="Volume upload progress" max={100} value={uploadPercent ?? undefined} />{uploadPercent === 100 ? 'Upload complete. Validating source geometry…' : uploadPercent === null ? 'Uploading volume…' : `Uploading volume: ${uploadPercent}%`}</div>}
      <Button type="submit" disabled={!installed || (!file && !dicomFiles.length) || !hu || !research || busy || active}>{busy ? 'Uploading and validating…' : active ? '3D analysis in progress…' : 'Run 3D segmentation'}</Button>
      {!installed && <p role="status">Volume analysis is unavailable for this case on this installation.</p>}
    </form>}
    {error && <p id="volume-error" role="alert" className="message error">{error}</p>}
    <section className="volume-saved-results" aria-label="Saved 3D results">
      {!runs.length ? <p className="muted">No 3D analyses yet. Submit a volume from Data & Uploads to start a run.</p> : <>
        <div className="volume-run-bar">
          <label>Saved analysis run<select value={selected?.id || ''} onChange={e => { setChosen(e.target.value); setMaskVersion(null); }}>{runs.map(run => <option key={run.id} value={run.id}>{utcDate(run.created_at).toLocaleString()} · {run.status} · {run.id.slice(0,8)}</option>)}</select></label>
          <span role="status" className={`cv-chip ${selected?.status === 'completed' ? 'ok' : selected?.status === 'failed' ? 'bad' : 'warn'}`}>{selected?.status}</span>
        </div>
        {selected?.error && <p role="alert" className="message error">{selected.error}</p>}
        {intakeOnly && selected?.status === 'completed' && <Link className="lv-goto" to={`/analysis?case_id=${encodeURIComponent(caseId)}`}>Open saved 3D analysis</Link>}
        {!intakeOnly && selected?.result && <>
          <AnalysisSectionNav key={selected.id} />
          {selected.input_kind === 'synthetic_fixture' && <div className="message warning" role="note"><strong>Synthetic geometry test — not a medical scan.</strong><p>This saved run used an artificial gradient, not coronary CTA anatomy. Grey slices and an empty vessel mask do not demonstrate medical segmentation. Upload a real, de-identified CTA from Assets & preparation.</p></div>}
          {selected.input_kind === 'unspecified' && <p className="message warning">Legacy source provenance is unspecified. Verify the original volume before interpreting this result.</p>}
          {selected.result.coarse_foreground_voxels === 0 && <p className="message warning">No vessel overlay was produced by this model. This is not a healthy/normal finding; check source eligibility and image quality and obtain expert review.</p>}
          {selected.result.preprocessing?.roi && <p className="message info">Whole-chest scan: the model read a {selected.result.preprocessing.roi.fov_mm} mm cube centred on the heart (its training field of view).{selected.result.postprocessing ? ` ${selected.result.postprocessing.components.filter(c => !c.kept).length} predicted component(s), ${selected.result.postprocessing.removed_voxels.toLocaleString()} voxels, lay more than ${selected.result.postprocessing.max_median_distance_mm} mm from the cardiac chambers and were removed as off-heart; the unfiltered model mask is kept in the downloads.` : ''}</p>}
          <section id="v3d-overview" className="volume-findings-summary" aria-labelledby="volume-findings-title">
            <div className="volume-findings-heading"><div><p className="eyebrow">SAVED 3D CASE</p><h4 id="volume-findings-title">Analysis findings</h4></div><span className="cv-chip ok">{selected.status}</span></div>
            <dl className="volume-summary-grid">
              <div><dt>Model</dt><dd>{selected.result.model_id}</dd></div>
              <div><dt>Source volume</dt><dd>{selected.result.source_shape.join(' × ')} voxels</dd></div>
              <div><dt>Segmentation</dt><dd>Saved prediction · review required</dd></div>
              <div><dt>Vessel geometry</dt><dd>{geometryReason ? `Not assessable · ${geometryReason}` : geometry ? `${geometry.paths?.length ?? 0} extracted paths` : 'Loading assessment…'}</dd></div>
              <div><dt>Stenosis candidates</dt><dd>{candidates.length ? `${candidates.length} experimental candidate${candidates.length === 1 ? '' : 's'}` : (geometry ? 'No eligible candidate' : reportError ? 'Assessment unavailable' : 'Loading assessment…')}</dd></div>
              <div><dt>Estimated narrowing</dt><dd>{primaryCandidate ? `${primaryCandidate.narrowing_percent.toFixed(2)}%` : topEstimate ? <>{topEstimate.narrowing_percent.toFixed(1)}% <span className="research-tag">research estimate · {topEstimate.path_id}</span></> : 'Not assessable'}</dd></div>
              <div className="volume-severity-result"><dt>Severity grading</dt><dd>{primaryCandidate ? (primaryCandidate.severity ?? 'Grade withheld') : topEstimate ? <>{BAND_LABEL[topEstimate.research_band] ?? topEstimate.research_band} <span className="research-tag">research estimate</span></> : 'Not assessable'}</dd></div>
              <div><dt>Reason</dt><dd>{primaryCandidate ? 'Experimental mask-geometry result; expert review required.' : geometryReason ? `Measurement withheld because the saved prediction is ${geometryReason}.` : topEstimate ? `No path passed the strict candidate rules; the values shown are the narrowest per-path mask-width estimate (MLD ${topEstimate.minimum_diameter_mm.toFixed(2)} mm vs RVD ${topEstimate.reference_diameter_mm.toFixed(2)} mm).` : 'No eligible 3D narrowing measurement is available.'}</dd></div>
            </dl>
          </section>
          <VolumeSourcePanel caseId={caseId} runId={selected.id} token={token} input_kind={selected.input_kind} source_shape={selected.result.source_shape} preprocessing={selected.result.preprocessing} hasSourceGridMask={selected.status === 'completed'} />
          {selected.status === 'completed' && <VolumeLinkedViewer key={`lv-${selected.id}`} caseId={caseId} runId={selected.id} token={token} shape={selected.result.source_shape} heatId={heat.id} heatLabel={heat.label}
            previewUrl={selected.preview_url} target={viewTarget} selectedPath={activePath?.points_ras_mm} candidatePanel={candidates.length > 0 ? <><VolumeCandidateList candidates={candidates} selectedId={selectedCandidate?.id} onSelect={selectCandidate} /><p className="caption">Yellow: crosshair · orange: selected path. Artery names need reviewer identification.</p><div className="lv-candidate-actions"><a className="lv-goto" href="#v3d-measurements">Review selected candidate measurements</a><a className="lv-goto" href="#v3d-vessel" onClick={() => { if (selectedCandidate) setFocusPath({id: selectedCandidate.path_id, nonce: Date.now()}); }}>Open CPR at selection</a></div></> : null} maskVersion={maskVersion} onCrosshair={setCrosshair}>
            <VolumeMprViewer key={`mpr-${selected.id}`} caseId={caseId} runId={selected.id} token={token} shape={selected.result.source_shape} heatId={heat.id} heatLabel={heat.label} />
          </VolumeLinkedViewer>}
          {selected.status === 'completed' && <VolumeMaskReviewPanel key={`mr-${selected.id}`} caseId={caseId} runId={selected.id} token={token} activeVersion={maskVersion} onUseVersion={setMaskVersion} crosshair={crosshair}
            onLocate={(ras, label) => setViewTarget({ ras: [ras[0], ras[1], ras[2]], label, nonce: Date.now() })} />}
          <details key={selected.id}><summary>{selected.input_kind === 'synthetic_fixture' ? 'Show synthetic test slices (not medical images)' : 'Saved coarse-grid previews (model input resolution)'}</summary>
          <div className="volume-slices">{selected.result.slices.map(slice => <figure key={slice.artifact}>
            {previews[slice.artifact] ? <img src={previews[slice.artifact]} alt={`Predicted coronary overlay on ${slice.axis} slice ${slice.coarse_index}`} /> : <p>Loading saved preview…</p>}
            <figcaption>{slice.axis} · coarse slice {slice.coarse_index}</figcaption></figure>)}</div></details>
          <div className="cv-actions" role="group" aria-label="Model output downloads"><span className="cv-actions-label">Model outputs</span>
            <Button variant="outline" size="sm" onClick={() => void download('mask_source.nii.gz')}><Download size={14} /> Source-grid mask (NIfTI)</Button>
            {selected.result?.postprocessing && <Button variant="outline" size="sm" onClick={() => void download('mask_source_raw.nii.gz')}><Download size={14} /> Unfiltered model mask</Button>}
            <Button variant="outline" size="sm" onClick={() => void download('probability_coarse.nii.gz')}><Download size={14} /> Probability volume</Button>
            <Button variant="outline" size="sm" onClick={() => void download('result.json')}><FileJson size={14} /> Result JSON</Button></div>
          <section className="volume-measurement-report" aria-label="3D measurement report">
            <div className="volume-section-heading"><div><p className="eyebrow">MEASUREMENTS</p><h4>Vessel geometry and narrowing</h4></div></div>
            {!report && <><section id="v3d-vessel" className="v3d-subsection"><h4>Vessel analysis</h4><p>{reportError || 'Loading saved geometry…'}</p></section><section id="v3d-candidates" className="v3d-subsection"><h4>Stenosis candidates</h4><p>{reportError || 'Loading candidate assessment…'}</p></section><section id="v3d-measurements" className="v3d-subsection"><h4>Measurements</h4><p>{reportError || 'Loading measurement assessment…'}</p></section><section id="v3d-severity" className="v3d-subsection"><h4>Research severity</h4><p>Awaiting an eligible measurement assessment.</p></section></>}
            {reportError ? <p role="alert">{reportError}</p> : !report ? <p role="status">Loading saved-run report…</p> : <>
              {report.experimental_geometry && <section aria-label="Experimental 3D geometry">

                <div id="v3d-candidates" className="volume-subsection-heading"><h4>Stenosis candidates</h4><span>{(report.experimental_geometry.paths ?? []).length} paths · {(report.experimental_geometry.paths ?? []).reduce((sum,path)=>sum+path.length_mm,0).toFixed(2)} mm traced</span></div>
                {candidates.length > 0 && <VolumeCandidateList candidates={candidates} selectedId={selectedCandidate?.id} onSelect={selectCandidate} />}
                {!(report.experimental_geometry.candidates ?? []).length && <p className="message info">No path met the strict candidate rules: enough centreline (27+ samples) for a guarded reference on both sides, a stable reference, and ≥ 25 % narrowing measured on perpendicular cross-sections. Exploratory per-path mask-width estimates are listed below.</p>}
                <section id="v3d-measurements" className="v3d-subsection" tabIndex={-1} aria-label="Candidate measurements">
                  <h4>Candidate lumen measurements</h4>
                  <VolumeMeasurementPanel previewUrl={selected.preview_url} token={token} paths={geometry?.paths} candidates={report.experimental_geometry.candidates ?? []} selectedId={selectedCandidate?.id} onSelect={id => { const candidate = candidates.find(row => row.id === id); if (candidate) selectCandidate(candidate, false); }} />
                  {!candidates.length && <p>No quality-eligible candidate has perpendicular lumen measurements for this run. {geometryReason ? `Assessment withheld: ${geometryReason}.` : 'Inspect the separate exploratory path estimates below when available.'}</p>}
                </section>
                <div id="v3d-vessel" className="v3d-subsection" tabIndex={-1}><h4>Vessel analysis and curved reformation</h4></div>
                {(report.experimental_geometry.paths ?? []).length > 0 && <VolumeCprReview key={`cpr-${selected.id}`} caseId={caseId} runId={selected.id} token={token}
                  candidatePathIds={(report.experimental_geometry.candidates ?? []).map(candidate => candidate.path_id)} paths={report.experimental_geometry.paths ?? []} estimates={estimates} focusPathId={focusPath?.id} focusNonce={focusPath?.nonce} candidateLocation={selectedCandidate?.location_ras_mm} candidatePathId={selectedCandidate?.path_id} onPathSelect={id => {
                    setFocusPath({ id, nonce: Date.now() });
                    const matchingCandidate = candidates.find(candidate => candidate.path_id === id);
                    if (matchingCandidate) {
                      setCandidateId(matchingCandidate.id);
                      if (selected) saveViewerSession(caseId + "." + selected.id + ".candidate", matchingCandidate.id);
                    }
                  }} onLocate={(ras, pathId) => focusLocation(ras, 'CPR inspection point', pathId)} maskSha256={report.experimental_geometry.mask_sha256} onSaved={reloadReport} />}
                <section id="v3d-severity" className="v3d-subsection" tabIndex={-1} aria-label="Research severity">
                  <h4>Research severity assessment</h4>
                  <p>{selectedCandidate ? `${candidateLabel(selectedCandidate.id)}: ${selectedCandidate.severity ?? 'Grade withheld'} · ${selectedCandidate.narrowing_percent.toFixed(2)}% experimental narrowing; expert review required.` : 'No quality-eligible strict candidate supports an accepted severity grade. Exploratory estimates remain separate.'}</p>
                </section>
                {estimates.length > 0 && <details className="volume-estimates"><summary>Advanced research details · exploratory path estimates</summary>
                  <div className="volume-subsection-heading"><h4>Lumen estimates by path <span className="research-tag">exploratory research estimate</span></h4><span>{estimates.length} narrowest of {(report.experimental_geometry.paths ?? []).length} paths</span></div>
                  <div className="table-scroll"><table className="stenosis-summary">
                    <thead><tr><th>Path</th><th>MLD</th><th>RVD</th><th>Narrowing</th><th>Research band</th><th>Length</th><th>RAS location (mm)</th><th>Candidate status</th><th>Views</th></tr></thead>
                    <tbody>{estimates.map(row => <tr key={row.path_id}>
                      <td>{row.path_id}</td><td>{row.minimum_diameter_mm.toFixed(2)} mm</td><td>{row.reference_diameter_mm.toFixed(2)} mm</td>
                      <td><div className="narrowing-cell"><div className="narrowing-bar"><i style={{ width: `${Math.min(100, row.narrowing_percent)}%` }} /></div>{row.narrowing_percent.toFixed(1)}%</div></td>
                      <td><span className={`band band-${row.research_band}`}>{BAND_LABEL[row.research_band] ?? row.research_band}</span></td>
                      <td>{row.length_mm.toFixed(1)} mm</td><td>{row.location_ras_mm.map(v => v.toFixed(1)).join(', ')}</td>
                      <td>{row.eligible_candidate ? `Eligible (${row.eligible_candidate})` : (row.withheld_reason ?? '').replaceAll('_', ' ')}</td><td><button type="button" className="lv-goto" onClick={()=>focusLocation(row.location_ras_mm, `path ${row.path_id} narrowest point`, row.path_id)}>Show in views</button></td></tr>)}</tbody>
                  </table></div>
                  <p className="caption">MLD is the narrowest mask width along the path; RVD is the median width elsewhere on the same path. Bands: minimal &lt; 25 %, mild 25–49 %, moderate 50–69 %, severe ≥ 70 %. Research demonstration only, from predicted-mask geometry.</p>
                </details>}
                {(report.experimental_geometry.limitations?.length
                  ? report.experimental_geometry.limitations
                  : (report.experimental_geometry.reasons ?? []).map(reason => `Measurement withheld: ${reason.replaceAll('_',' ')}.`)
                ).slice(0,1).map(text=><p className="message warning volume-primary-warning" role="note" key={text}>{text}</p>)}
                {(report.experimental_geometry.limitations?.length ?? 0) > 1 && <details className="volume-method-notes"><summary>Method notes</summary><ul>{report.experimental_geometry.limitations?.slice(1).map(text=><li key={text}>{text}</li>)}</ul></details>}
              </section>}
              {!report.experimental_geometry && <><section id="v3d-vessel" className="v3d-subsection"><h4>Vessel analysis</h4><p>No saved geometry is available for this run.</p></section><section id="v3d-candidates" className="v3d-subsection"><h4>Stenosis candidates</h4><p>No candidate assessment is available for this run.</p></section><section id="v3d-measurements" className="v3d-subsection"><h4>Measurements</h4><p>No quality-eligible lumen measurements are available.</p></section><section id="v3d-severity" className="v3d-subsection"><h4>Research severity</h4><p>Not assessable without eligible measurements.</p></section><table className="stenosis-summary">
                <caption>Selected 3D scan measurement assessment</caption>
                <thead><tr><th scope="col">Minimum lumen</th><th scope="col">Reference lumen</th><th scope="col">Narrowing</th><th scope="col">Research severity</th></tr></thead>
                <tbody><tr><td>Unavailable</td><td>Unavailable</td><td>Unavailable</td><td>{report.stages.severity?.status.replaceAll('_', ' ') ?? 'Unavailable'}</td></tr></tbody>
              </table></>}
          {selected.status === 'completed' && <div id="v3d-xai" className="v3d-anchor" />}
          {selected.status === 'completed' && <VolumeXaiPanel key={`xai-${selected.id}`} token={token} caseId={caseId} runId={selected.id} onShow={showHeat} />}
              <h5 className="cv-subtitle">Pipeline stages</h5>
              <dl className="volume-stage-grid">{Object.entries(report.stages).map(([name,item])=>{
                const withheld = geometry?.status === 'abstained' && name !== 'segmentation';
                const status = withheld ? 'not assessable' : item.status.replaceAll('_',' ');
                return <div key={name}>
                  <dt>{name.replaceAll('_',' ')}</dt>
                  <dd><span className={`cv-chip ${status.includes('review') ? 'warn' : status.includes('not assessable') || status.includes('blocked') ? 'muted' : 'info'}`}>{status}</span></dd>
                </div>;
              })}</dl>
              <VolumeReviewPanel selectedId={selected.id} runs={runs.map(run => ({ id: run.id, created_at: utcDate(run.created_at).toLocaleString(), status: run.status, model_id: run.result?.model_id ?? run.model_key ?? 'Unavailable' }))} />
              <div id="v3d-reports" className="v3d-anchor" />
              <VolumeReports key={selected.id} endpoint={`/api/cases/${caseId}/volumes/analyses/${selected.id}`}
                token={token} runId={selected.id} caseId={caseId} />
            </>}
          </section>
          <VolumeReferenceMetrics key={`reference-${selected.id}`} caseId={caseId} runId={selected.id} token={token} onSaved={reloadReport} />
          <details><summary>Model limitations and provenance</summary><p>Run: {selected.id} · Model: {selected.result.model_id}. The vessel mask is mapped back to the original volume grid.</p><ul>{(selected.result.limitations ?? []).map(value => <li key={value}>{value}</li>)}</ul></details>
        </>}
      </>}
    </section>
  </section>;
}
