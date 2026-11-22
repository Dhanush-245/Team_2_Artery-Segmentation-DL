import { lazy } from "react";
import { Button } from "../components/prismui/button";
import { Card } from "../components/prismui/card";
import { Input } from "../components/prismui/input";
import Alert1 from "../components/watermelon/alert-1";
import DocumentUploader from "../components/ui/file-upload-5";
import type { CaseRecord } from "../caseTypes";
import { standardPipelines } from "../preprocessingPipelines";
import ScreenShareSelect from "../ScreenShareSelect";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { caseStatusLabel } from "../caseTypes";

const VolumeIntake = lazy(() => import("../VolumeIntake"));
const VolumeInference = lazy(() => import("../VolumeInference"));

const isDicom = (name: string) => /\.(dcm|dicom)$/i.test(name);
const isPdf = (name: string) => /\.pdf$/i.test(name);

/** Coronary CTA, or aorta CT/CTA, has a pinned 3D research segmentation model. */
export function volumeInferenceEligible(record: CaseRecord) {
  const modalities = record.modalities || [record.modality];
  return (record.anatomy === "coronary" && modalities.includes("CTA")) ||
    (record.anatomy === "aorta" && modalities.some(m => m === "CT" || m === "CTA"));
}

function CaseMetadata({ record }: { record: CaseRecord }) {
  return <div className="metadata">
    <div><span>Modality</span><strong>{record.modality}</strong></div>
    <div><span>Workflow</span><strong><span className="cv-chip info">{caseStatusLabel(record)}</span></strong></div>
    <div><span>Images</span><strong>{record.images.length}</strong></div>
  </div>;
}

function PreprocessingProfile() {
  const { user, upload } = useWorkspace();
  const { preprocessingProfile, setPreprocessingProfile, standardPipeline, setStandardPipeline, denoise, setDenoise, enhance, setEnhance } = upload;
  const research = preprocessingProfile === "research";
  const denoiseOn = research ? denoise : standardPipeline === "denoise" || standardPipeline === "balanced";
  const contrastOn = research ? enhance : standardPipeline === "contrast" || standardPipeline === "balanced";
  const pipelineFor = (noise: boolean, contrast: boolean) => noise ? contrast ? "balanced" : "denoise" : contrast ? "contrast" : "baseline";
  return <fieldset className="preprocessing-profile">
    <legend>Preprocessing profile</legend>
    <p className="caption">Choose any combination of enhancements. Standard preparation is always included.</p>
    <label><input type="checkbox" checked={preprocessingProfile === "standard" && standardPipeline === "baseline"} onChange={() => { setPreprocessingProfile("standard"); setStandardPipeline("baseline"); setDenoise(false); setEnhance(false); }} /><span><strong>Standard only</strong><small>Validation, grayscale / intensity normalization, optional ROI, aspect-preserving resize and padding, then quality check. Selecting this clears optional enhancements.</small></span></label>
    {standardPipelines.filter(pipeline => pipeline.id === "denoise" || pipeline.id === "contrast").map(pipeline => <label key={pipeline.id}><input type="checkbox" checked={pipeline.id === "denoise" ? denoiseOn : contrastOn} onChange={event => {
      const noise = pipeline.id === "denoise" ? event.target.checked : denoiseOn;
      const contrast = pipeline.id === "contrast" ? event.target.checked : contrastOn;
      if (research) { setDenoise(noise); setEnhance(contrast); }
      else setStandardPipeline(pipelineFor(noise, contrast));
    }} /><span><strong>{pipeline.title}</strong><small>{pipeline.description}</small></span></label>)}
    {(user.role === "researcher" || user.role === "admin") && <label><input type="checkbox" checked={research} onChange={event => {
      if (event.target.checked) { setDenoise(standardPipeline === "denoise" || standardPipeline === "balanced"); setEnhance(standardPipeline === "contrast" || standardPipeline === "balanced"); setPreprocessingProfile("research"); }
      else { setStandardPipeline(pipelineFor(denoise, enhance)); setDenoise(false); setEnhance(false); setPreprocessingProfile("standard"); }
    }} /><span><strong>Research mode</strong><small>Record the selected preparation as a controlled research comparison. This does not add another filtering pass.</small></span></label>}
  </fieldset>;
}

function ImageIntakeForm({ record }: { record: CaseRecord }) {
  const { busy, analysis: run, upload } = useWorkspace();
  const { selectedImage } = run;
  const { files, changeFiles, roi, setRoi, frameIndex, setFrameIndex, pageIndex, setPageIndex, preprocessingProfile, standardPipeline, denoise, enhance, uploadProgress, handleUpload } = upload;
  const activePipeline = preprocessingProfile === "standard" ? standardPipeline : denoise ? enhance ? "balanced" : "denoise" : enhance ? "contrast" : "baseline";
  return <>
    <ol className="processing-stepper" aria-label="Image intake steps">
      <li className={files.length ? "complete" : "active"}><span>1</span><div><strong>Select</strong><small>Images and options</small></div></li>
      <li className={uploadProgress ? "active" : record.images.length ? "complete" : ""}><span>2</span><div><strong>Validate</strong><small>Check and prepare</small></div></li>
      <li className={selectedImage ? "complete" : ""}><span>3</span><div><strong>Quality check</strong><small>Review preview</small></div></li>
    </ol>
    <form onSubmit={handleUpload} className="image-intake-form">
      <DocumentUploader files={files} onFilesChange={changeFiles} />
      <section className="intake-pipeline" aria-labelledby="intake-pipeline-title">
        <h4 id="intake-pipeline-title">Image preprocessing pipeline</h4>
        <p aria-live="polite">{standardPipelines.find(pipeline => pipeline.id === activePipeline)?.path}</p>
        <small>The original is retained. Each preset applies only its listed operations. Uploading does not start model training.</small>
      </section>
      <PreprocessingProfile />
      <p className="caption">Each profile preserves the original and records the operations applied. Enhanced profiles may change thin vessels and are not validated accuracy improvements. Compare with Standard.</p>
      <details className="upload-options"><summary>Frame, page and ROI options</summary>
        <label htmlFor="upload-roi">Region of interest (x,y,width,height in source pixels)</label>
        <Input id="upload-roi" placeholder="Optional, e.g. 40,50,300,300" value={roi} onChange={(e) => setRoi(e.target.value)} />
        {files.some((item) => isDicom(item.name)) && <><label htmlFor="frame-index">DICOM frame index (applies to DICOM files)</label><Input id="frame-index" type="number" min="0" step="1" placeholder="Required for multi-frame studies" value={frameIndex} onChange={(e) => setFrameIndex(e.target.value)} /></>}
        {files.some((item) => isPdf(item.name)) && <><label htmlFor="page-index">PDF page index (zero-based; applies to PDF files)</label><Input id="page-index" type="number" min="0" max="999" step="1" placeholder="Defaults to first page" value={pageIndex} onChange={(e) => setPageIndex(e.target.value)} /></>}
      </details>
      <Button type="submit" className="primary" disabled={busy || (!files.length && !selectedImage?.source_url)}>{busy ? "Processing…" : files.length ? `Validate and upload ${files.length} file${files.length === 1 ? "" : "s"}` : "Validate & reprocess saved original"}</Button>
      {uploadProgress && <div className="upload-progress" role="status"><progress value={uploadProgress.done} max={uploadProgress.total} /> <span>{uploadProgress.done} of {uploadProgress.total} · {uploadProgress.name}</span></div>}
    </form>
    <p className="upload-privacy-note">Use public or de-identified images. Supported raster formats, DICOM, and scanned PDF pages are processed. Office documents, masks, and unsupported formats are not valid inference images.</p>
  </>;
}

function DatasetIntakeNote() {
  const { setActiveView } = useWorkspace();
  return <div className="dataset-intake-note">
    <h4>ARCADE research dataset</h4>
    <p>Preserve the official <strong>syntax</strong> and <strong>stenosis</strong> tasks and their train, validation, and test splits. Keep each task’s image files paired with its own COCO annotation JSON and class schema.</p>
    <p>Dataset annotation conversion, split checks, duplicate auditing, and preprocessing use the ARCADE dataset pipeline. The case uploader below is for inference images and must not be used to turn annotation files into case images.</p>
    <code>python3 -m ml.preprocessing.run_preprocessing --data-root arcade --output-root data/processed/arcade</code>
    <Button type="button" variant="outline" onClick={() => setActiveView("models")}>Open model evaluation</Button>
  </div>;
}

function uploadModeHint(record: CaseRecord) {
  if (record.modality === "XCA") return "De-identified coronary angiography frames";
  if (record.anatomy === "aorta" && ["CT", "CTA"].includes(record.modality)) return "Pinned AortaSeg 3D research segmentation";
  if (record.modality === "CTA" && record.anatomy === "coronary") return "Pinned ImageCAS and ImageCAS-X 3D research segmentation";
  return "Preparation only; no compatible inference model";
}

function UploadCard({ record }: { record: CaseRecord }) {
  const { token, user, upload } = useWorkspace();
  const { uploadMode, setUploadMode } = upload;
  const researcher = user.role === "researcher" || user.role === "admin";
  return <Card className={`panel ${record.modality !== "XCA" ? "volume-assets-panel" : ""}`}>
    <h3>{record.modality === "XCA" ? "Upload image" : "3D volume workspace"}</h3>
    <p className="muted">CoroVision AI · {record.modality === "XCA" ? "Image intake and preprocessing" : "Separate research volume workflow"}</p>
    <fieldset className="upload-mode-picker">
      <legend>What are you uploading?</legend>
      <button type="button" className={uploadMode === "inference" ? "active" : ""} onClick={() => setUploadMode("inference")}><strong>{record.modality === "XCA" ? "Case image preparation" : "Research volume workflow"}</strong><small>{uploadModeHint(record)}</small></button>
      {researcher && <button type="button" className={uploadMode === "dataset" ? "active" : ""} onClick={() => setUploadMode("dataset")}><strong>Research dataset</strong><small>Images paired with annotations for training and evaluation</small></button>}
    </fieldset>
    {record.modality !== "XCA" ? <VolumeIntake key={record.id} caseId={record.id} token={token} readOnly={!researcher} anatomy={record.anatomy} inferenceEligible={volumeInferenceEligible(record)} />
      : uploadMode === "dataset" ? <DatasetIntakeNote /> : <>
        {record.anatomy === "coronary" && record.modalities?.includes("CTA") && <details><summary>Separate coronary CTA volume workflow</summary><VolumeIntake caseId={record.id} token={token} inferenceEligible readOnly={!researcher} /></details>}
        <ImageIntakeForm record={record} />
      </>}
    <CaseMetadata record={record} />
  </Card>;
}

function ReadOnlyIntakeCard({ record }: { record: CaseRecord }) {
  const { token } = useWorkspace();
  return <Card className="panel">
    <div className="viewer-heading"><h3>Study Intake</h3><span>Read-only</span></div>
    <p className="muted">This assignment does not allow image uploads. Upload requires case ownership or edit access and a role with upload permission.</p>
    {volumeInferenceEligible(record) && <VolumeInference caseId={record.id} token={token} anatomy={record.anatomy} readOnly />}
    <CaseMetadata record={record} />
  </Card>;
}

function QualityCheckCard({ record }: { record: CaseRecord }) {
  const { analysis: run } = useWorkspace();
  const { selectedImage, preview, setSelectedImageId } = run;
  return <Card className="panel viewer">
    <div className="viewer-heading"><h3>Step 3 of 3 · Quality check</h3><span>512 × 512</span></div>
    {record.images.length > 1 && <label className="image-picker" htmlFor="case-image">Image<ScreenShareSelect id="case-image" value={selectedImage?.id || ""} onChange={(event) => setSelectedImageId(event.target.value)}>{record.images.map((item) => <option key={item.id} value={item.id}>{item.original_name} · {item.id.slice(0, 8)}</option>)}</ScreenShareSelect></label>}
    {preview ? <img src={preview} alt={`Processed preview for case ${record.case_code}`} /> : <div className="image-empty">No images uploaded for this case yet.</div>}
    {selectedImage && <><p className="caption">Source: {selectedImage.original_name} · Original dimensions: {selectedImage.width} × {selectedImage.height} · Source spacing: {selectedImage.spacing_mm || "unavailable"}{selectedImage.processed_spacing_mm ? ` · Processed content spacing: ${selectedImage.processed_spacing_mm} mm` : ""}</p>
      <details className="preprocessing-steps"><summary>Preprocessing record · {selectedImage.processing_record?.pipeline_version || "legacy"}</summary><p>Profile: {selectedImage.processing_record?.profile || "standard"} · Pipeline: {selectedImage.processing_record?.standard_pipeline || "custom / legacy"} · Denoising: {selectedImage.processing_record?.options?.denoise ? "on" : "off"} · Contrast enhancement: {selectedImage.processing_record?.options?.contrast_enhancement ? "on" : "off"}</p><ol>{(selectedImage.preprocessing || []).map((step) => <li key={step}>{step.replaceAll("_", " ")}</li>)}</ol>{selectedImage.processing_record?.warnings?.map((warning) => <Alert1 tone="warning" announce={false} title="Preprocessing warning" key={warning}>{warning.replaceAll("_", " ")}</Alert1>)}<p>The trained model applies its documented 3×3 median and clipped autocontrast input transform at inference. Compare model overlays with the preserved original before interpreting results.</p>{selectedImage.roi_box && <p>ROI: {selectedImage.roi_box}</p>}{selectedImage.frame_index !== null && <p>DICOM frame index: {selectedImage.frame_index}</p>}{selectedImage.page_index != null && <p>PDF page: {selectedImage.page_index + 1}</p>}</details></>}
  </Card>;
}

function AnalysisEntryCard() {
  const { analysis: run, setActiveView } = useWorkspace();
  const { selectedImage, selectedAnalysis } = run;
  return <Card className="panel case-analysis-entry">
    <div>
      <p className="eyebrow">NEXT STEP</p>
      <h3>Coronary analysis</h3>
      <p>See the artery outline, vessel measurements and areas of possible narrowing together. CoroVision selects the research pipeline for your image.</p>
      <p className="caption">{selectedImage ? selectedImage.original_name : "Upload an angiogram to get started."}</p>
    </div>
    <Button type="button" className="primary" disabled={!selectedImage} onClick={() => setActiveView("analysis")}>{selectedAnalysis ? "View combined findings" : "Open analysis"}</Button>
  </Card>;
}

/** "Assets & preparation" tab of a case. */
export default function CaseAssetsPanel({ record }: { record: CaseRecord }) {
  const { user, analysis: run } = useWorkspace();
  const canUpload = record.permissions?.can_upload ?? user.role !== "viewer";
  return <>
    {canUpload ? <UploadCard record={record} /> : <ReadOnlyIntakeCard record={record} />}
    {record.modality === "XCA" && <QualityCheckCard record={record} />}
    {record.anatomy === "coronary" && (run.selectedImage?.modality || record.modality) === "XCA" && <AnalysisEntryCard />}
  </>;
}
