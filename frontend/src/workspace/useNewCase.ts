import { FormEvent, useState } from "react";
import { request } from "../api";
import type { CaseRecord } from "../caseTypes";

type Options = {
  token: string;
  loadCases: (token: string) => Promise<void>;
  onCreated: (created: CaseRecord) => void;
  setBusy: (busy: boolean) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
};

/** "Create case" / "Find case" panel state and the create request. */
export function useNewCase({ token, loadCases, onCreated, setBusy, setError, setNotice }: Options) {
  const [caseCode, setCaseCode] = useState("");
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [caseFinderOpen, setCaseFinderOpen] = useState(false);
  const [newModality, setNewModality] = useState("XCA");
  const [newAnatomy, setNewAnatomy] = useState("coronary");
  const [newTasks, setNewTasks] = useState<string[]>(["artery_and_stenosis"]);
  const [newSource, setNewSource] = useState("");

  function changeModality(modality: string) {
    setNewModality(modality);
    setNewTasks(modality === "XCA" ? ["artery_and_stenosis"] : ["volume_preparation"]);
    if (modality === "XCA") setNewAnatomy("coronary");
  }

  function closeCasePanels() {
    setNewCaseOpen(false);
    setCaseFinderOpen(false);
  }

  async function handleNewCase(event: FormEvent) {
    event.preventDefault();
    if (!newTasks.length) { setError("Select at least one intended task."); return; }
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const created = await request<CaseRecord>(
        "/api/cases", token, { case_code: caseCode.trim(), modality: newModality, anatomy: newAnatomy,
          intended_task: newTasks[0], intended_tasks: newTasks, source_dataset: newSource.trim() || null }, "POST",
      );
      await loadCases(token);
      setCaseCode("");
      setNewCaseOpen(false);
      onCreated(created);
      setNotice("Research case created. Open Data & Uploads to add supported inputs.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return {
    caseCode, setCaseCode, newCaseOpen, setNewCaseOpen, caseFinderOpen, setCaseFinderOpen, closeCasePanels,
    newModality, changeModality, newAnatomy, setNewAnatomy, newTasks, setNewTasks, newSource, setNewSource, handleNewCase,
  };
}

export type NewCase = ReturnType<typeof useNewCase>;
