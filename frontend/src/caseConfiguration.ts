export const caseTasks = [
  ["artery_and_stenosis", "Artery and stenosis research"],
  ["artery_segmentation", "Artery segmentation"],
  ["stenosis_localization", "Stenosis localization"],
  ["volume_preparation", "3D volume workflow"],
] as const;
/** Only combinations with a connected research model can be created. Keep in sync with backend SUPPORTED_PAIRS. */
export const supportedPairs: Record<string, string[]> = { XCA: ["coronary"], CTA: ["coronary", "aorta"], CT: ["aorta"] };
export const caseModalityOptions = [["XCA", "X-ray angiography"], ["CTA", "CT angiography"], ["CT", "CT"]] as const;
export const caseAnatomies = ["coronary", "aorta"];
export const anatomiesFor = (modality: string) => supportedPairs[modality] ?? [];
export function taskLabel(task?: string) {
  return caseTasks.find(([id]) => id === task)?.[1] || "Legacy research configuration";
}
