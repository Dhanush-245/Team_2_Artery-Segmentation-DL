# Extended 3D evidence authorization

Standard Evidence ZIP remains the default. It excludes source CTA, probability volumes and native attribution volumes. The optional extended endpoint wraps the byte-identical Standard Evidence ZIP with one specifically approved de-identified source NIfTI. It retains the report version and snapshot hash, and publishes a separate manifest with byte counts and hashes.

## Approval and revocation

A deployment operator can mount a read-only JSON approval file outside the upload and evidence trees and set `COROVISION_EXTENDED_EVIDENCE_APPROVALS` to its path. An unset or unreadable policy denies extended downloads. Ordinary case access and research-export permission are always required.

After obtaining the applicable dataset permission and verifying de-identification, record the approval ID, approved recipient user ID, case ID, run ID, exact report version, source SHA-256, dataset licence or approval reference, decision maker, and timezone-aware expiry. The endpoint requires `artifact` equal to `artifacts/source.nii.gz` and `deidentified` equal to true. Fields are named `approval_id`, `user_id`, `case_id`, `run_id`, `report_version`, `source_sha256`, `license_reference`, `approved_by`, and `expires_at`. Keep policy contents private. Remove the matching entry to revoke future downloads.

Request the authorized saved version at `GET /api/cases/{case_id}/volumes/analyses/{run_id}/extended-evidence.zip?version={version}`. The standard archive and source bytes are verified. The source limit is 64 MiB. Up to two extended downloads can be in flight per application process. Successful packaging creates an audit event. The endpoint does not authorize additional artifact types.

Local tests use a generated synthetic NIfTI and test-only approvals. Applying a policy to external research datasets requires their actual release permissions. No real-case approval was installed in this checkout or on Railway.
