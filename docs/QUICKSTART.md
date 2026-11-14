# Clean-clone quick start

Requirements: Docker Desktop or Docker Engine with Compose, at least 4 GiB free disk space, 8 GiB RAM recommended, and network access to the public hash-pinned model release during the first build.

```bash
git clone --branch lingareddy-dhanush https://github.com/springboardmentor01092s-tech/Team_2_Artery-Segmentation-DL.git
cd Team_2_Artery-Segmentation-DL
python scripts/configure.py
```

```bash
python scripts/preflight.py
docker compose up --build -d
docker compose exec app python -m app.cli create-admin
```

Open <http://127.0.0.1:8000>. Check readiness with:

```bash
curl -fsS http://127.0.0.1:8000/api/health/ready
```

The first build installs the permitted 2D research checkpoints after verifying their fixed release hashes. The 3D checkpoint is a separately supplied artifact; the 3D interface reports an actionable unavailable state when it is absent. No dataset or training workspace is downloaded.

Each clone uses its own database, administrator and storage. Never reuse hosted credentials in a cloned installation. See [administrator access](ADMIN_ACCESS.md), [Railway deployment](RAILWAY_DEPLOYMENT.md), and [troubleshooting](TROUBLESHOOTING.md).
