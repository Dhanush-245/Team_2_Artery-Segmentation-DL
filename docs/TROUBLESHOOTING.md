# Deployment troubleshooting

| Symptom | Check | Resolution |
|---|---|---|
| Preflight says Docker unavailable | `docker info` | Start Docker Desktop/Engine, then rerun preflight. |
| `.env` missing | `ls -la .env` | Copy `.env.example`, generate a private `JWT_SECRET`, and never commit `.env`. |
| Port 8000 is occupied | `COROVISION_PORT=8001` in `.env` | Restart Compose and open the configured port. |
| Build cannot download models | Network and GitHub release access | Retry the build. Do not substitute unverified checkpoints. |
| Ready endpoint reports model unavailable | `/api/health/ready` | Rebuild the image and inspect checkpoint verification logs. |
| 3D action says checkpoint unavailable | `COROVISION_3D_CHECKPOINT` | Provision the exact separately verified ImageCAS checkpoint or use the synthetic geometry demonstrations. |
| Upload or report storage is read-only | `/api/health/ready` storage field | Verify the `/data` volume permissions and mount. |
| Login fails after restart | Stable `JWT_SECRET` and persistent `/data` | Restore the original secret from the deployment secret manager and confirm the database volume persists. |
| Analysis job fails | Saved job error and server logs | The case is preserved. Correct the input/model issue and submit a new run. |
| Email recovery unavailable | SMTP variables | Configure SMTP or use the private server-owner administrator recovery command. |

Do not paste tokens, passwords, patient data or private checkpoints into support logs.
