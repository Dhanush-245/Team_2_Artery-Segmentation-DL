# Railway deployment

This deployment serves the React frontend and FastAPI API from one Docker service.

## Required Railway resources

1. Create a Railway project from the GitHub repository and select branch `lingareddy-dhanush` (or `review` for acceptance testing).
2. Add PostgreSQL and expose its `DATABASE_URL` to the application service.
3. Add a persistent volume mounted at `/data`. It stores uploaded and generated application artifacts. The public, hash-verified 2D checkpoints are installed in the private container image during the Docker build and are never committed to Git.
4. Generate a private secret locally and set it as `JWT_SECRET`:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

5. Set these application variables:

   ```text
   COROVISION_ENV=production
   COROVISION_INFERENCE_WORKER=1
   CV_LOCAL_DEMO_SESSIONS=0
   CV_LOCAL_DEMO_SHARING=0
   STORAGE_DIR=/data/storage
   FRONTEND_ORIGIN=https://YOUR-DOMAIN
   OAUTH_REDIRECT_BASE=https://YOUR-DOMAIN
   CORS_ORIGINS=https://YOUR-DOMAIN
   ```

   The image runs as the non-root user 10001, while Railway mounts volumes owned by root. If readiness reports storage as not writable, set `RAILWAY_RUN_UID=0` (Railway's documented switch for this case) and redeploy.

   Replace `YOUR-DOMAIN` with the service's Railway domain (Settings → Networking → Generate Domain). Do not set `COROVISION_TRAINED_RELEASE`: the image already points it at `/models/trained_release`, where the build installs the verified models. Overriding it with `/models` makes the release unreadable and inference reports unavailable.

Railway supplies `PORT`; the container binds to it. The Docker build downloads the public, hash-pinned 2D model release and verifies its internal release contract and checkpoint hashes. Model files are not committed to Git.

The current 3D checkpoint is a separately supplied private artifact. Copy its exact hash-verified file to `/data/models/volume_release/imagecas128.pt`, then set `COROVISION_3D_CHECKPOINT` to that path. Without it, the application remains available but the 3D inference action reports that its checkpoint is not installed.

## First administrator

After the first successful deployment, open a private Railway shell and run:

```bash
python -m app.cli create-admin
```

Then open the Railway HTTPS domain and sign in. See [administrator access](ADMIN_ACCESS.md).

## Acceptance checks

```bash
curl -fsS https://YOUR-DOMAIN/api/health/live
curl -fsS https://YOUR-DOMAIN/api/health/ready
```

The ready endpoint must report both database and inference readiness. Upload only public or properly de-identified research data. Railway deployment is engineering acceptance, not clinical validation.
