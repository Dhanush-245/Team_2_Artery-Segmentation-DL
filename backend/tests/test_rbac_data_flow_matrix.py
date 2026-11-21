"""Per-role data-flow matrix: every role sees exactly the cases it owns or is
assigned to, and admin/model/export surfaces follow the role policy."""
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import User
from app.security import hash_password

ROLES = ["admin", "doctor", "clinician", "researcher", "ml_engineer", "technician", "viewer"]
PW = "matrix-pass-12345"


def _login(client, role, suffix=""):
    email = f"matrix-{role}{suffix}@test.org"
    with SessionLocal() as db:
        if not db.scalar(select(User).where(User.email == email)):
            db.add(User(email=email, password_hash=hash_password(PW), role=role, status="active"))
            db.commit()
    token = client.post("/api/auth/login", json={"email": email, "password": PW}).json()["access_token"]
    return email, {"Authorization": f"Bearer {token}"}


def test_role_data_flow_matrix():
    with TestClient(app) as c:
        users = {r: _login(c, r) for r in ROLES}
        h = {r: users[r][1] for r in ROLES}

        # Doctor owns a case and shares it: researcher=read, technician=edit, viewer=read.
        case_id = c.post("/api/cases", headers=h["doctor"], json={"case_code": "MATRIX-001"}).json()["id"]
        for role, level in [("researcher", "read"), ("technician", "edit"), ("viewer", "read")]:
            r = c.post(f"/api/cases/{case_id}/access", headers=h["doctor"],
                       json={"user_email_or_id": users[role][0], "access_level": level})
            assert r.status_code == 201, (role, r.text)
        # Clinician owns a private case nobody else is assigned to.
        private_id = c.post("/api/cases", headers=h["clinician"], json={"case_code": "MATRIX-PRIV"}).json()["id"]

        sees_shared = {"doctor", "researcher", "technician", "viewer"}
        for role in ROLES:
            listing = c.get("/api/cases", headers=h[role])
            if role == "ml_engineer":
                assert listing.status_code == 403  # no case workspace at all
                assert c.get(f"/api/cases/{case_id}", headers=h[role]).status_code == 403
                assert c.get("/api/dashboard/analytics", headers=h[role]).status_code == 403
                continue
            ids = {x["id"] for x in listing.json()}
            assert (case_id in ids) == (role in sees_shared), role
            assert (private_id in ids) == (role == "clinician"), role
            detail = c.get(f"/api/cases/{case_id}", headers=h[role]).status_code
            assert detail == (200 if role in sees_shared else 404), (role, detail)
            # The private case is invisible (404, not 403) to everyone but its owner.
            if role != "clinician":
                assert c.get(f"/api/cases/{private_id}", headers=h[role]).status_code == 404, role
                assert c.get(f"/api/cases/{private_id}/analyses", headers=h[role]).status_code == 404, role
            # Dashboard aggregates only readable cases.
            dash = c.get("/api/dashboard/analytics", headers=h[role]).json()
            assert dash["total_cases"] == len(ids), role
            assert ("validation_performance" in dash and bool(dash["validation_performance"]) is False) or role in {"admin", "researcher"}

        # Admin is not an implicit reader of clinical cases (assignment required).
        assert c.get(f"/api/cases/{case_id}", headers=h["admin"]).status_code == 404

        # Edit/review levels: read-only assignees cannot change or review.
        assert c.patch(f"/api/cases/{case_id}", headers=h["researcher"], json={"notes": "x"}).status_code in {403, 422}
        assert c.post(f"/api/cases/{case_id}/review", headers=h["viewer"], json={"decision": "reviewed"}).status_code == 403
        assert c.post(f"/api/cases/{case_id}/review", headers=h["researcher"], json={"decision": "reviewed"}).status_code == 403
        # Only the owner (or admin) may share; an assignee cannot re-share.
        assert c.post(f"/api/cases/{case_id}/access", headers=h["technician"],
                      json={"user_email_or_id": users["clinician"][0], "access_level": "read"}).status_code == 403
        # Only owner/admin may delete.
        assert c.delete(f"/api/cases/{case_id}", headers=h["technician"]).status_code == 403

        # Export: researcher (assigned) may export, viewer/technician may not.
        assert c.get(f"/api/cases/{case_id}/export", headers=h["researcher"]).status_code == 200
        assert c.get(f"/api/cases/{case_id}/export", headers=h["viewer"]).status_code == 403
        assert c.get(f"/api/cases/{case_id}/export", headers=h["technician"]).status_code == 403
        assert c.get(f"/api/cases/{case_id}/research-reports", headers=h["viewer"]).status_code == 403
        assert c.get(f"/api/cases/{case_id}/research-reports", headers=h["researcher"]).status_code == 200

        # Admin-only surfaces.
        for path in ["/api/admin/users", "/api/admin/audit", "/api/admin/trash", "/api/admin/access-requests",
                     "/api/admin/operations", "/api/admin/metrics"]:
            for role in ROLES:
                code = c.get(path, headers=h[role]).status_code
                assert code == (200 if role == "admin" else 403), (path, role, code)
        for role in ROLES:
            code = c.post("/api/admin/invitations", headers=h[role], json={"email": f"inv-{role}@test.org"}).status_code
            assert (code == 201) == (role == "admin"), (role, code)

        # Model registry: admin, researcher, ml_engineer only.
        for role in ROLES:
            code = c.get("/api/analysis/models", headers=h[role]).status_code
            assert code == (200 if role in {"admin", "researcher", "ml_engineer"} else 403), (role, code)
            code = c.get("/api/evaluation/runs", headers=h[role]).status_code
            assert code == (200 if role in {"admin", "researcher", "ml_engineer"} else 403), (role, code)
        assert c.get("/api/analysis/status", headers=h["viewer"]).json() == {"models_ready": False, "research_only": True}

        # Notifications are per-recipient: sharing notified nobody outside the case,
        # and nobody can read someone else's notification.
        doctor_notes = c.get("/api/notifications", headers=h["doctor"]).json()
        for role in ["admin", "ml_engineer", "clinician"]:
            assert all(n["case_id"] != case_id for n in c.get("/api/notifications", headers=h[role]).json()), role
        c.delete(f"/api/cases/{case_id}", headers=h["doctor"])  # notifies assignees
        tech_notes = c.get("/api/notifications", headers=h["technician"]).json()
        assert any(n["case_id"] == case_id for n in tech_notes)
        nid = tech_notes[0]["id"]
        assert c.post(f"/api/notifications/{nid}/read", headers=h["viewer"]).status_code in {404}
        assert c.post("/api/notifications/bulk", headers=h["clinician"], json={"ids": [nid], "action": "delete"}).status_code == 404

        # Deleted case disappears for everyone, appears in admin trash only.
        for role in ["doctor", "researcher", "technician", "viewer"]:
            assert case_id not in {x["id"] for x in c.get("/api/cases", headers=h[role]).json()}
            assert c.get(f"/api/cases/{case_id}", headers=h[role]).status_code == 404
        assert case_id in {x["id"] for x in c.get("/api/admin/trash", headers=h["admin"]).json()}

        # Permission bits surfaced to the UI match the action policy.
        perms = {r: set(c.get("/api/auth/me", headers=h[r]).json()["permissions"]) for r in ROLES}
        assert perms["viewer"] == {"case:read_assigned"}
        assert perms["ml_engineer"] == {"model:read"}
        assert "users:manage" in perms["admin"] and "users:manage" not in perms["doctor"]
        assert "clinical_review:create" in perms["doctor"] and "clinical_review:create" not in perms["researcher"]


def test_case_sharing_rejects_deleted_cases_and_non_case_roles():
    with TestClient(app) as c:
        doctor = _login(c, "doctor", "-share")
        ml = _login(c, "ml_engineer", "-share")
        viewer = _login(c, "viewer", "-share")
        cid = c.post("/api/cases", headers=doctor[1], json={"case_code": "MATRIX-SHARE"}).json()["id"]
        assert c.post(f"/api/cases/{cid}/access", headers=doctor[1],
                      json={"user_email_or_id": ml[0], "access_level": "read"}).status_code == 422
        c.delete(f"/api/cases/{cid}", headers=doctor[1])
        assert c.post(f"/api/cases/{cid}/access", headers=doctor[1],
                      json={"user_email_or_id": viewer[0], "access_level": "read"}).status_code == 404
