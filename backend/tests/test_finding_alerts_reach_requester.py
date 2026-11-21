"""Model-finding alerts must also reach the person who ran the analysis.

Before this change notify_case skipped the actor, so a researcher analysing their
own case never received "stenosis detected" or "analysis failed" alerts.
Collaboration events (comments, updates) still skip the actor.
"""
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app, notify_case
from app.models import Case, Notification
from test_rbac_system import make_user


def _case_for(owner_id: str, code: str) -> str:
    with SessionLocal() as db:
        case = Case(owner_id=owner_id, case_code=code)
        db.add(case); db.commit()
        return case.id


def _kinds(user_id: str) -> set[str]:
    with SessionLocal() as db:
        return set(db.scalars(select(Notification.kind).where(Notification.user_id == user_id)))


def test_finding_alerts_include_the_requester():
    with TestClient(app):
        owner, _ = make_user("finding-owner@test.org", "researcher")
        case_id = _case_for(owner["id"], "ALERT-SELF-1")
        with SessionLocal() as db:
            case = db.get(Case, case_id)
            for kind in ("model_stenosis_flag", "model_multiple_regions", "analysis_failed", "validation_failed",
                         "analysis_quality_review", "model_uncertainty_review"):
                notify_case(db, case, owner["id"], kind, f"{kind} for {case.case_code}")
            db.commit()
        assert {"model_stenosis_flag", "model_multiple_regions", "analysis_failed", "validation_failed",
                "analysis_quality_review", "model_uncertainty_review"} <= _kinds(owner["id"])


def test_collaboration_events_still_skip_the_actor():
    with TestClient(app):
        owner, _ = make_user("collab-owner@test.org", "researcher")
        case_id = _case_for(owner["id"], "ALERT-SELF-2")
        with SessionLocal() as db:
            case = db.get(Case, case_id)
            notify_case(db, case, owner["id"], "case_comment", "comment")
            notify_case(db, case, owner["id"], "case_updated", "updated")
            db.commit()
        assert not ({"case_comment", "case_updated"} & _kinds(owner["id"]))
