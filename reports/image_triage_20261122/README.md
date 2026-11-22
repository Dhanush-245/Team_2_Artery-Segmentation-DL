# Release image vulnerability triage (M4-04) — 22 November 2026

Scanner: Trivy 0.65.0 (same pinned image as CI), HIGH and CRITICAL, vulnerability scanner only.

| Image | CRITICAL | HIGH | HIGH with a fixed version available |
|---|---:|---:|---:|
| Before (Debian 13 slim + `poppler-utils`) | 0 | 124 | 0 |
| After (Poppler removed; PDF pages rendered by PDFium) | 0 | 50 | 0 |

## Change

`poppler-utils` was used only to rasterize one uploaded PDF page. It pulled in curl, Kerberos, libtiff,
gnupg/gpgme, X11/cairo and fontconfig. PDF pages are now rendered by `pypdfium2==4.30.0` (self-contained wheel)
in a separate, 20-second time-limited process (`backend/app/pdf_render.py`), preserving the previous isolation.
Output geometry is unchanged (a 128×96 page renders to 2048×1536, as with `pdftoppm -scale-to 2048`).
Corrupt PDFs are rejected with the same user message. Removed packages: dirmngr, gnupg, gnupg-l10n, gpg, gpg-agent, gpgconf, gpgsm, libcurl3t64-gnutls, libexpat1, libgssapi-krb5-2, libk5crypto3, libkrb5-3, libkrb5support0, libtiff6, libx11-6, libx11-data, libxrender1.

## Remaining 50 HIGH findings

All are in Debian base-image packages that the Python runtime or the OS needs; none has a fixed version in
Debian 13 at scan time (Trivy status: {'affected': 49, 'fix_deferred': 1}).

| Package | Findings |
|---|---:|
| bsdutils | 4 |
| libblkid1 | 4 |
| liblastlog2-2 | 4 |
| libmount1 | 4 |
| libsmartcols1 | 4 |
| libuuid1 | 4 |
| login | 4 |
| mount | 4 |
| util-linux | 4 |
| libsqlite3-0 | 3 |
| libacl1 | 1 |
| libncursesw6 | 1 |
| libssl3t64 | 1 |
| libsystemd0 | 1 |
| libtinfo6 | 1 |
| libudev1 | 1 |
| ncurses-base | 1 |
| ncurses-bin | 1 |
| openssl | 1 |
| openssl-provider-legacy | 1 |
| perl-base | 1 |

Decision: **accept for the research deployment**, with no CRITICAL findings and no available fixes. Re-scan when
Debian publishes fixes (CI already scans every build and fails on fixable CRITICAL findings). Moving to a distroless
or Chainguard Python base would remove most of the remainder and is the next option if a stricter policy applies.
Full per-CVE lists: `trivy_high_critical.json`.
