import { FormEvent, useRef, useState } from "react";
import { apiUrl } from "../api";
import { toast } from "../lib/toast";
import type { StandardPipeline } from "../preprocessingPipelines";
import type { ImageRecord } from "../caseTypes";

export type UploadProgress = { done: number; total: number; name: string };

const isDicom = (name: string) => /\.(dcm|dicom)$/i.test(name);
const isPdf = (name: string) => /\.pdf$/i.test(name);

type Options = {
  token: string;
  selectedId: string;
  selectedImage: ImageRecord | undefined;
  loadCases: (token: string) => Promise<void>;
  onUploaded: (imageId: string) => void;
  setBusy: (busy: boolean) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
};

/** Upload form state for "Assets & preparation"; kept per session so it survives section switches. */
export function useCaseUpload({ token, selectedId, selectedImage, loadCases, onUploaded, setBusy, setError, setNotice }: Options) {
  const [files, setFiles] = useState<File[]>([]);
  const [roi, setRoi] = useState("");
  const [frameIndex, setFrameIndex] = useState("");
  const [pageIndex, setPageIndex] = useState("");
  const [uploadMode, setUploadMode] = useState<"inference" | "dataset">("inference");
  const [preprocessingProfile, setPreprocessingProfile] = useState<"standard" | "research">("standard");
  const [standardPipeline, setStandardPipeline] = useState<StandardPipeline>("baseline");
  const [denoise, setDenoise] = useState(false);
  const [enhance, setEnhance] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const uploadInFlight = useRef(false);

  function changeFiles(next: File[]) {
    setFiles(next);
    if (!next.some((item) => isDicom(item.name))) setFrameIndex("");
    if (!next.some((item) => isPdf(item.name))) setPageIndex("");
  }

  function uploadBody(file: File, reprocessing: boolean) {
    const body = new FormData();
    body.append("file", file);
    const selectedRoi = roi.trim() || (reprocessing ? selectedImage?.roi_box || "" : "");
    const selectedFrame = frameIndex || (reprocessing && selectedImage?.frame_index != null ? String(selectedImage.frame_index) : "");
    const selectedPage = pageIndex || (reprocessing && selectedImage?.page_index != null ? String(selectedImage.page_index) : "");
    if (selectedRoi) body.append("roi", selectedRoi);
    if (selectedFrame !== "" && isDicom(file.name)) body.append("frame_index", selectedFrame);
    if (selectedPage !== "" && isPdf(file.name)) body.append("page_index", selectedPage);
    body.append("profile", preprocessingProfile);
    body.append("standard_pipeline", preprocessingProfile === "standard" ? standardPipeline : "baseline");
    body.append("denoise", String(preprocessingProfile === "research" && denoise));
    body.append("enhance", String(preprocessingProfile === "research" && enhance));
    return body;
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || uploadInFlight.current) return;
    if (!files.length && !selectedImage?.source_url) return;
    uploadInFlight.current = true;
    setError("");
    setNotice("");
    setBusy(true);
    setUploadProgress({ done: 0, total: files.length, name: files[0]?.name || "" });
    try {
      let uploadFiles = files;
      const reprocessing = !uploadFiles.length;
      if (reprocessing && selectedImage?.source_url) {
        const original = await fetch(apiUrl(selectedImage.source_url), { headers: { Authorization: `Bearer ${token}` } });
        if (!original.ok) throw new Error("Could not load the preserved original for reprocessing.");
        uploadFiles = [new File([await original.blob()], selectedImage.original_name)];
      }
      let lastUploadedId = "";
      const failures: string[] = [];
      const duplicates: string[] = [];
      const remaining: File[] = [];
      for (const [index, file] of uploadFiles.entries()) {
        setUploadProgress({ done: index, total: uploadFiles.length, name: file.name });
        try {
          const response = await fetch(apiUrl(`/api/cases/${selectedId}/images`), {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: uploadBody(file, reprocessing),
          });
          if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            if (response.status === 409 && String(result.detail || "").toLowerCase().includes("already attached")) {
              duplicates.push(file.name);
              continue;
            }
            throw new Error(result.detail || "Upload failed");
          }
          const uploaded = await response.json() as { id: string };
          lastUploadedId = uploaded.id;
        } catch (cause) {
          failures.push(`${file.name}: ${(cause as Error).message}`);
          remaining.push(file);
        }
        setUploadProgress({ done: index + 1, total: uploadFiles.length, name: file.name });
      }
      await loadCases(token);
      onUploaded(lastUploadedId);
      setFiles(remaining);
      if (!remaining.length) { setRoi(""); setFrameIndex(""); setPageIndex(""); }
      if (lastUploadedId) setNotice(`${uploadFiles.length - failures.length - duplicates.length} study image(s) validated and prepared.${duplicates.length ? ` Skipped exact duplicate: ${duplicates.join(", ")}.` : ""}`);
      else if (duplicates.length) setNotice(`No new images added. Skipped exact duplicate: ${duplicates.join(", ")}.`);
      if (failures.length) { setError(failures.join(" ")); toast.error(`${failures.length} file(s) could not be uploaded.`); }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
      setUploadProgress(null);
      uploadInFlight.current = false;
    }
  }

  return {
    files, changeFiles, roi, setRoi, frameIndex, setFrameIndex, pageIndex, setPageIndex,
    uploadMode, setUploadMode, preprocessingProfile, setPreprocessingProfile, standardPipeline, setStandardPipeline,
    denoise, setDenoise, enhance, setEnhance, uploadProgress, handleUpload,
  };
}

export type CaseUpload = ReturnType<typeof useCaseUpload>;
