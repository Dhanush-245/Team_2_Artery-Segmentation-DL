# Likely vessel segment labels (research)

2D coronary angiography candidates can show a **likely vessel segment**. These are SYNTAX segment numbers with usual anatomical names, for example `7 · LAD mid`. The label appears in:

- the *Saved candidate measurements* table;
- the research PDF;
- the evidence ZIP, as `vessel_segments.json`.

## How it works

- A 26-class ARCADE SYNTAX segment model, `arcade-syntax-segments-resnet34-unet-26c-v1`, labels every vessel pixel of the prepared 512×512 image.
- Each saved candidate is assigned with the frozen protocol `corovision-lesion-to-segment-v1`:
  - The candidate polygon is dilated by 5 px.
  - The predicted vessel pixels inside that region vote.
  - A segment is named only if it wins at least 50% of the votes and is one of the 11 reliable segments: 1–8, 11, 13 and 16.
- Any other candidate is shown as *Side branch · not named*, *Ambiguous* or *Not assessable*.
- Labels are computed on first view of a saved run and cached per run, prepared image and checkpoint. Any user with read access to the case can view them (`GET /api/cases/{case_id}/vessel-segments/{event_id}`).

## Evidence and limits

| Item | Value |
|---|---|
| Accuracy on the 11 reliable segments | Precision 0.90 and coverage 0.81 |
| Overall precision | About 0.87 |
| Test data | Lesion-sized probes on ARCADE SYNTAX **validation** images |
| Real stenosis lesions | 311 of 406 ARCADE stenosis validation lesions receive a named segment |

- A narrowing on a side branch can be named as its parent vessel.
- This is development-exposed validation evidence, not independent or clinical localisation.

## Installing the model

The checkpoint is not published with the source.

- **File:** `models/segment_release/syntax_segments_26c.pt`
- **SHA-256:** `f74ee0da6ab23a55878e5a211099ce7d06a8fa1fa49f11c90e95a343d9ec44c5`

Place the checkpoint at that path, then add the override:

```bash
docker compose -f compose.yaml -f compose.segments.yaml up -d --build
```

Outside Docker, set `COROVISION_SEGMENT_CHECKPOINT` to the file. If the file is missing or the hash does not match, the column reads *Model not installed* and nothing else changes.
