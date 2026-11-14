# VilChum detection service (`obj-recognition` branch)

Counts aluminium cans and plastic bottles in a photo with our YOLO model (`model/best.pt`) and
returns an **estimate**. VilChum never pays from this number: points become spendable only after
a driver verifies the pickup. Glass bottles are detected but not accepted.

This branch is a **standalone service**. It has everything needed to run on the GPU PC and
shares no files with the web app branches. Do not merge `main` into it, and do not merge it into
`main`.

```
app.py                     FastAPI service
model/best.pt              trained model (classes: aluminium-cans, glass-bottle, plastic-bottle)
requirements.txt           pinned dependencies (PyTorch installed separately, see step 3)
.env.example               configuration template -> copy to .env
scripts/setup.ps1          one-time install in the right order + GPU check
scripts/verify_gpu.py      proves PyTorch can actually use the GPU
scripts/install-service.ps1  Windows service via NSSM
cloudflared/config.example.yml  only for a locally-managed tunnel
tests/                     pytest suite (runs on CPU too)
train.py, predict.py, val_test.py, runs/   training history (not used by the service)
```

## 1. Get only this branch onto the GPU PC

```powershell
git clone --branch obj-recognition --single-branch https://github.com/issacpenthy-netizen/Vilchum.git C:\vilchum-detect
cd C:\vilchum-detect
```

`--single-branch` downloads only this branch, so the PC never holds web-app code or its
configuration. Later updates: `git pull`, then restart the service (section 6).

> The repository is public, so `model/best.pt` is downloadable by anyone. Make the repository
> private if the model should stay ours.

## 2. Prerequisites

| What | Why |
|---|---|
| NVIDIA driver **570 or newer** | RTX 50-series (RTX 5070) support. Prefer the *Studio* driver: Game Ready updates arrive often and each one is a chance to break CUDA. |
| Python **3.12** from python.org, with the *py launcher* option ticked | `scripts\setup.ps1` runs `py -3.12`. |
| Git for Windows | Cloning and updates. |
| NSSM (https://nssm.cc/download), unzipped to e.g. `C:\tools\nssm` | Runs the service at boot, restarts it on crash. |
| cloudflared (`winget install --id Cloudflare.cloudflared`) | The tunnel. |

## 3. Install (CUDA build of PyTorch first)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

The script does this, in this order:

1. Creates `.venv` with Python 3.12.
2. Installs the **CUDA** build of PyTorch:
   ```powershell
   .venv\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
   ```
   - `pip install torch` from PyPI installs a **CPU-only** build on Windows. Never run it here.
   - **Do not use the CUDA 12.1 (`cu121`) build.** The RTX 5070 is a Blackwell GPU (compute
     capability `sm_120`); cu121 builds contain no kernels for it. They either report
     "not compatible with the current PyTorch installation" or fail with
     "no kernel image is available". cu128 (or newer) is required.
3. Installs `requirements.txt` (PyTorch is already satisfied, so pip keeps the CUDA build).
4. Removes the GUI `opencv-python` that Ultralytics pulls in and keeps `opencv-python-headless`.
5. Stops if a CPU-only PyTorch ended up installed.
6. Creates `.env` with a fresh random `API_KEY` (if `.env` doesn't exist).
7. Runs `scripts\verify_gpu.py`, which must end with `🔥 GPU ready`.

Send the `API_KEY` from `.env` to whoever configures the web app (it becomes
`ESTIMATOR_API_KEY` there), over a private channel. Never paste it into chat groups or commit it.

Run it by hand once before installing the service:

```powershell
.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

The log must show `🔥 GPU ACTIVE: NVIDIA GeForce RTX 5070 ...`. If it shows the `RUNNING ON CPU`
banner, go back to step 3. In a second window:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Then set `REQUIRE_GPU=true` in `.env`, so the service refuses to start on CPU instead of quietly
running 10-50x slower.

## 4. API

`GET /health`: no key needed. Returns 200 when ready and 503 when the model failed to load:

```json
{"status": "ok", "gpu_active": true, "model_loaded": true, "device": "cuda", "version": "1.1.0"}
```

`POST /detect`: header `X-API-Key: <API_KEY>`, `multipart/form-data` with field `image`
(JPEG/PNG/WebP, max 12 MB).

```json
{
  "status": "success",
  "items": [{"label": "can", "confidence": 0.92}, {"label": "bottle", "confidence": 0.81}],
  "summary": {"cans": 1, "bottles": 1, "overall_confidence": "high", "min_confidence": 0.81,
              "reasons": [], "not_accepted": {"glass_bottles": 0}},
  "meta": {"inference_ms": 18, "device": "cuda", "version": "1.1.0", "blur_score": 65.4}
}
```

- `status` is `low_confidence` (and `overall_confidence` is `low`) when **any** accepted item
  scores below `LOW_CONFIDENCE_THRESHOLD` (0.50). Detections below `DETECTION_FLOOR` (0.25) are
  dropped.
- **Blurry photos** are always `low_confidence`, whatever the model says. On blurry photos the model
  reports confident false cans (0.52-0.56 on a photo of one bottle) and false glass. The photo's
  sharpness is checked first: size and contrast are normalised, so dark but sharp photos are not
  flagged. Any score below `BLUR_THRESHOLD` (16) is flagged.
- `summary.reasons` explains a `low_confidence` result: `blurry`, `low_item_confidence`, or both.
  The app uses it to tell the user what to fix.
- `meta.blur_score` is returned with every result, so the threshold can be tuned on real photos.
  Calibration so far comes from one sample photo after the app's own resizing and re-compression,
  plus synthetic tests. Sharp versions scored 24 or more, including very dark and low-contrast
  ones. Blurred versions where the model went wrong, and smooth low-contrast blobs, scored 11 or
  less. The margins are narrow (about 1.5x), so collect real `blur_score` values in the beta and
  re-tune.
- Zero items is `success` with zero counts, unless the photo is blurry.
- `not_accepted.glass_bottles` lets the app say "glass isn't accepted" instead of silently
  undercounting.

| HTTP | `error` | Meaning |
|---|---|---|
| 400 | `image_required`, `invalid_image`, `image_too_small` | Bad or corrupt upload (the server keeps running). |
| 401 | `unauthorized` | Missing or wrong `X-API-Key`. Checked before the upload is read. |
| 413 | `image_too_large` | Over `MAX_UPLOAD_BYTES`. |
| 503 | `busy`, `model_unavailable` | Queue full, or the model didn't load. Retry later. |
| 500 | `internal_error` | Unexpected; details only in `logs\service.log`. |

Photos are decoded in memory and never written to disk or logged.

## 5. Run as a Windows service (NSSM)

Administrator PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 -Nssm "C:\tools\nssm\win64\nssm.exe"
```

This installs the `VilChumDetect` service:
- starts at boot (delayed start, so the GPU driver and network are up first);
- restarts 5 s after any crash;
- listens on **127.0.0.1:8000 only**, so the tunnel is the only way in;
- logs to `logs\service.log`, rotated at 10 MB.

Services run without anyone logged in. Day-to-day commands:

```powershell
nssm status VilChumDetect
nssm restart VilChumDetect
Get-Content logs\service.log -Tail 50
```

## 6. Cloudflare Tunnel (permanent URL)

You need a domain on Cloudflare (for example `vilchum.com`). The service gets a fixed hostname
such as `detect.vilchum.com`. Quick tunnels (`trycloudflare.com`) change URL on every restart, so
they're not for production.

### Option A, recommended: dashboard-managed tunnel (survives reboots, no config files)

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** →
   *Cloudflared* → name it `vilchum-detect`.
2. Choose **Windows** and copy the install command it shows. In an **Administrator**
   PowerShell, run:
   ```powershell
   cloudflared.exe service install <TOKEN-FROM-DASHBOARD>
   ```
   This installs cloudflared as a Windows service that starts at boot.
3. **Public Hostname** tab → **Add a public hostname**:
   - Subdomain `detect`, domain `vilchum.com`
   - Service type **HTTP**, URL **`localhost:8000`**
4. Check from any machine: `curl https://detect.vilchum.com/health`.

### Option B: locally-managed named tunnel (CLI)

```powershell
cloudflared tunnel login                      # opens the browser; pick the domain
cloudflared tunnel create vilchum-detect      # prints the tunnel ID, writes <ID>.json
cloudflared tunnel route dns vilchum-detect detect.vilchum.com
```

Copy `cloudflared\config.example.yml` to
`C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`, fill in the tunnel ID and
hostname, and copy `%USERPROFILE%\.cloudflared\<ID>.json` next to it. The Windows service runs
as SYSTEM and reads from there. Then run `cloudflared service install` as Administrator.

### Strongly recommended: block strangers at Cloudflare's edge

The API key stops unauthorised detections, but strangers can still knock on the PC. With
Cloudflare Access, their requests never reach it:

1. Zero Trust → **Access** → **Service Auth** → **Service Tokens** → create `vilchum-web`. Save
   the Client ID and Secret.
2. **Access** → **Applications** → **Add** → *Self-hosted* → domain `detect.vilchum.com` →
   policy with action **Service Auth** that includes that service token.
3. Give the Client ID and Secret to the web app (`ESTIMATOR_CF_ACCESS_CLIENT_ID` /
   `ESTIMATOR_CF_ACCESS_CLIENT_SECRET`). It sends them as `CF-Access-Client-Id` /
   `CF-Access-Client-Secret` alongside `X-API-Key`.

Leave `/health` reachable by your uptime monitor: either add a second Access policy for it, or
monitor through the web app's own health endpoint.

### CORS and preview deployments

The VilChum web app calls this service **from its server**, so browsers never see the API key,
and CORS doesn't apply. Keep `ALLOWED_ORIGINS` **empty** in that setup: browsers then can't call
the service at all.

Only if a browser must call it directly (not recommended: the key would be visible in
devtools):
- List exact production origins in `ALLOWED_ORIGINS=https://vilchum.com,https://www.vilchum.com`.
- For Vercel or Netlify preview URLs, use a tight pattern rather than `*`, e.g.
  `ALLOWED_ORIGIN_REGEX=^https://vilchum-git-[a-z0-9-]+-yourteam\.vercel\.app$`.
- Wildcards are refused at startup.

## 7. Gaming PC reliability checklist

The web app treats this PC as **unreliable by design**. If it's offline, users see "Photo
checking is busy, try again in a minute" and nothing is lost. Still, every hour it's down is an
hour nobody can scan.

- [ ] **Never sleep:** `powercfg /change standby-timeout-ac 0`, `powercfg /change hibernate-timeout-ac 0`, `powercfg /h off` (Administrator).
- [ ] **Power plan:** High performance; *PCI Express → Link State Power Management: Off*.
- [ ] **BIOS:** *Restore on AC power loss* → **Power On**, so the PC comes back after a power cut.
- [ ] **Windows Update:** set Active hours and keep *Notify me when a restart is required* on. Restart deliberately, not at 3 a.m. by surprise.
- [ ] **No login needed:** both services (`VilChumDetect`, `cloudflared`) start at boot without a user signed in. Test it with a full restart and no login.
- [ ] **Wired Ethernet**, not Wi-Fi. A UPS if the area has power cuts.
- [ ] **Driver updates:** after any NVIDIA driver update, run `.venv\Scripts\python scripts\verify_gpu.py`.
- [ ] **Gaming:** games compete for the GPU and its memory. Detection gets slower and can time out. Either don't game during service hours, or stop the service while gaming: `nssm stop VilChumDetect`. Users then see the busy message.
- [ ] **Antivirus:** if scans are slow, exclude `C:\vilchum-detect\.venv` from real-time scanning.
- [ ] **Monitoring:** an uptime check (e.g. UptimeRobot, Cloudflare health checks) on `https://detect.vilchum.com/health` every minute, alerting the team. Alert on `gpu_active: false` too.
- [ ] **Disk:** keep `logs\` under control (rotation is on) and never save user photos on this PC.

## 8. Updating

```powershell
cd C:\vilchum-detect
git pull
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pytest -q
nssm restart VilChumDetect
```

New model: replace `model/best.pt`, run the tests, restart. The service refuses to start if the
model doesn't have the `aluminium-cans` and `plastic-bottle` classes.

## 9. Tests

```powershell
.venv\Scripts\python -m pip install pytest httpx
.venv\Scripts\python -m pytest -q
```

The suite runs the real model on CPU or GPU. It covers authentication, corrupt and oversized
uploads, CORS, low-confidence results, and the sample photo (one plastic bottle).
