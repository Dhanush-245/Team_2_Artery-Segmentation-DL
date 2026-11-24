"""Normal-versus-abnormal screening label for a saved 2D analysis.

This is not a separately trained classifier and not a diagnosis. It turns the stenosis detector's own output into
a three-way screening label so a reviewer can triage studies:

* abnormal_flagged: at least one candidate has a raw detector score at or above the frozen operating point (0.25).
* not_flagged: nothing reached that score and the artery segmentation was usable. This does NOT establish a
  normal vessel; a lesion can be missed.
* indeterminate: nothing was flagged but the segmentation or its scores are too weak to say anything.

Scores are uncalibrated, so the label says "flagged by the model", never "disease present".
"""

SCREENING_SCORE_THRESHOLD = 0.25   # the operating point frozen in the 20 Nov threshold study
MIN_ARTERY_PIXELS = 500            # below this the artery was effectively not segmented
UNCERTAINTY_CODES = {'low_foreground_score', 'uncertain_pixels'}

DISPLAY = {'abnormal_flagged': 'Abnormal: model-flagged region', 'not_flagged': 'Not flagged by the model',
           'indeterminate': 'Indeterminate'}
LIMITATIONS = ('Screening label derived from the detector output, not a trained normal-versus-abnormal classifier and not a '
               'diagnosis. "Not flagged" does not establish a normal vessel; a lesion can be missed. Scores are uncalibrated.')


def screening_from_result(structured: dict | None, vessel: dict | None = None, artery_pixels: int | None = None) -> dict:
    structured = structured or {}
    vessel = vessel or {}
    candidates = [c for c in (structured.get('candidates') or []) if isinstance(c, dict)]
    scored = [(str(c.get('candidate_id') or '?'), float(c.get('model_score') or 0.0)) for c in candidates]
    flagged = [identifier for identifier, score in scored if score >= SCREENING_SCORE_THRESHOLD]
    pixels = artery_pixels if artery_pixels is not None else vessel.get('mask_pixels')
    flags = {f.get('code') for f in (structured.get('quality') or {}).get('flags', []) if isinstance(f, dict)}
    reasons = []
    if flagged:
        label = 'abnormal_flagged'
        reasons.append(f'{len(flagged)} candidate{"s" if len(flagged) != 1 else ""} at or above the operating point '
                       f'({", ".join(flagged[:5])}); clinician review is required')
    elif pixels is not None and pixels < MIN_ARTERY_PIXELS:
        label = 'indeterminate'
        reasons.append('The artery was barely or not segmented, so a missing candidate means little')
    elif flags & UNCERTAINTY_CODES:
        label = 'indeterminate'
        reasons.append('Model scores are unstable or low for this image; inspect the probability map')
    else:
        label = 'not_flagged'
        reasons.append('No candidate reached the operating point' if scored else 'The detector produced no candidate')
    return {'schema_version': 'corovision.screening.v1', 'label': label, 'display': DISPLAY[label],
            'basis': {'rule': f'A candidate with raw detector score >= {SCREENING_SCORE_THRESHOLD} flags the study',
                      'threshold': SCREENING_SCORE_THRESHOLD, 'candidates': len(scored), 'flagged_candidates': flagged,
                      'max_score': round(max((score for _, score in scored), default=0.0), 4)},
            'reasons': reasons, 'limitations': LIMITATIONS, 'clinical_validated': False}
