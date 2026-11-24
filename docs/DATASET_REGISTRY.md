# CoroVision AI dataset registry

**Last reviewed:** 2026-11-24 (table below dated 2026-10-13; see the status update at the end)

**Policy:** Keep modality, anatomical region, label semantics, and evaluation protocol separate. No dataset in this registry is combined with another by copying files into a shared training folder.

| Dataset | Local status | Modality and anatomy | Verified labels | Permitted project use | Blocking condition |
|---|---|---|---|---|---|
| ARCADE | Present at `arcade/` | 2D X-ray coronary angiography | Separate SYNTAX vessel instances/categories and stenosis-region instances | Primary coronary X-ray benchmark, with separate vessel and stenosis experiments | Patient/study mapping is absent from the public files; do not claim patient-level independence or launch new controlled training until the authors reply. |
| CARDIAG · Zenodo 19958730 | Archive index and split lists verified on 2026-11-10 | 2D coronary X-ray angiography | Indexed binary vessel, narrowing and uncertainty masks for all 645 samples | Separate external reference candidate under CC BY 4.0 | Full grouping and checkpoint-exposure audit, reference semantics and geometry review, and remote execution eligibility. See the [intake receipt](../reports/cardiag_intake_20261110/REVIEW.md). |
| ICA_NJ_BinarySeg v1.0 | Downloaded at `data/external/ICA_NJ_BinarySeg/` | 2D invasive coronary angiography | Binary vessel masks only | Separate vessel-mask external-audit cohort; potential external test after provenance and split policy are resolved | No declared license file or explicit patient mapping in the repository. Filename prefixes are not accepted as patient IDs. It cannot train or evaluate stenosis localization. |
| DCA1 | Not downloaded | 2D coronary angiography | Vessel masks reported by the source | Candidate external vessel dataset | Official host timed out on 2026-10-13; license, exact contents, and grouping must be verified before use. |
| ASOCA | Access request required | 3D coronary CT angiography | Coronary lumen masks | Separate 3D coronary CT segmentation project | Controlled access and dataset terms; do not mix with 2D X-ray training or ARCADE metrics. |
| ImageCAS | Not acquired | 3D coronary CT angiography | Coronary vessel segmentation reported by benchmark | Separate 3D CT project after access and licensing audit | Access and version must be verified before download. |
| AortaSeg-60 | Not acquired | 3D thoraco-abdominal CT/CTA | Automatically generated aorta masks | Separate aorta segmentation research task only | 15.9 GB download; masks are automated rather than manually corrected, and no stenosis labels are included. |
| TopCoW | Not acquired | CTA/MRA cerebral vessels | Cerebral vessel masks and graph labels | Separate brain-vessel segmentation research task only | Different anatomy/modality and license requirements; no basis for coronary stenosis claims. |
| Medical Segmentation Decathlon Task 08 | Not acquired | CT hepatic vessels | Hepatic-vessel and tumour masks | Separate hepatic-vessel segmentation research task only | Different anatomy and label semantics; no coronary or stenosis labels. |

## Training matrix

| Experiment | Input | Target | Split rule | Primary metrics |
|---|---|---|---|---|
| XCA vessel anatomy | ARCADE `syntax` | Original instance/category annotations | Official partitions remain unchanged; patient-independence unresolved | Official ARCADE instance F1, then per-class Dice/IoU |
| XCA stenosis localization | ARCADE `stenosis` | Original stenosis instances | Official partitions remain unchanged; patient-independence unresolved | Official instance F1; supplementary lesion precision/recall and Dice/IoU |
| XCA vessel generalization | ICA binary masks | Binary vessel mask | New patient-level split only if authors publish grouping metadata; otherwise descriptive audit only | Dice, IoU, precision, recall, sensitivity, specificity |
| CT coronary vessels | ASOCA or ImageCAS | Source-specific 3D vessel/lumen mask | Source-approved case-level split | Dice, HD95, connectivity and centerline coverage |
| Aorta/brain/hepatic vessels | Source-specific separate dataset | Source-specific masks | Source-approved case-level split | Source-specific segmentation metrics |

## Non-negotiable constraints

1. Train separate models for vessel segmentation and stenosis localization.
2. Do not merge 2D X-ray and 3D CT/CTA samples into one model training run.
3. Do not infer patient identity from ARCADE image IDs, ICA filename prefixes, or pixel similarity.
4. Keep the ARCADE test split locked; never tune thresholds, select models, or report a final result from it more than once.
5. Record checksum, source URL, version, date, split manifest, seed, code revision, environment, and metrics for every experiment.

## Status update, 24 November 2026

Checked against the workspace and the offline Kaggle copy. The table above is kept as written on 13 October; where this section differs, this section is newer.

| Dataset | What exists now | Used for | Not re-verified in this update |
|---|---|---|---|
| ARCADE | Processed copy under `data/processed/arcade`; Kaggle-prepared stenosis and mask datasets | Artery segmentation and stenosis detection (release models, validation of 200 images, one-time protected test) | Patient independence of the official partitions remains unresolved |
| CARDIAG | Archive index and split lists (10 Nov) | Candidate external audit | Not downloaded in full |
| ICA_NJ_BinarySeg | Downloaded, 1,233 files under `data/external/ICA_NJ_BinarySeg` | Separate external vessel-mask audit | Patient grouping metadata |
| DCA1 | `data/raw/dca1` is empty in this workspace; a prepared 2D set (`corovision-dca2d-prepared`) exists in the offline Kaggle copy | Public sample images in demonstrations | Original download and license text for the prepared copy |
| CADICA | Archive present (about 179 MB) and a Kaggle-prepared input set | Separate stenosis experiments | Completeness of the archive |
| ImageCAS | Prepared 128-voxel volumes (`corovision-imagecas128-prepared`, train 700 / validation 150 / test 150, seed-42 case split) and checkpoints | 3D coronary CTA segmentation release model and the scale fine-tune experiment | Access, version and license audit of the source release |
| ASOCA | Not acquired (controlled access) | None | Permission still required |
| AortaSeg-60, MSD Task08, TopCoW | Partial archives only (25 MB, 50 MB, 4.1 MB in `data/raw`) | Not used by the release | Completeness; not part of the coronary workflow |
| Mendeley stenosis archive | Present (about 837 MB) | Exploratory | Labels and license not audited here |

Rules unchanged: no dataset is pooled with another, test splits are never used for selection, and only public or de-identified data may enter the application.
