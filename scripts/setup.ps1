# One-time setup on the GPU PC. Run from the repository root in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# Installs packages in the order that keeps the CUDA build of PyTorch.

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path "model\best.pt")) { throw "model\best.pt is missing. Are you on the obj-recognition branch?" }

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Creating virtual environment with Python 3.12..."
    py -3.12 -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 not found. Install it from python.org (tick 'py launcher')." }
}
$python = Resolve-Path ".venv\Scripts\python.exe"

& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }

# 1) CUDA build of PyTorch FIRST. cu128 supports RTX 50-series (sm_120); cu121 does not.
& $python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) { throw "PyTorch CUDA install failed" }

# 2) Service dependencies. torch is already satisfied, so pip keeps the CUDA build.
& $python -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "requirements install failed" }

# 3) Ultralytics pulls in the GUI opencv-python, which shadows the headless build. Keep headless only.
& $python -m pip uninstall -y opencv-python
& $python -m pip install --force-reinstall --no-deps opencv-python-headless==5.0.0.93
if ($LASTEXITCODE -ne 0) { throw "opencv-python-headless reinstall failed" }

# 4) Fail loudly if anything replaced the CUDA build with the CPU one.
& $python -c "import torch, sys; sys.exit(0 if torch.version.cuda else 1)"
if ($LASTEXITCODE -ne 0) { throw "A CPU-only PyTorch was installed. Re-run step 1 with --force-reinstall." }

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    $key = & $python -c "import secrets; print(secrets.token_urlsafe(48))"
    (Get-Content ".env") -replace "^API_KEY=$", "API_KEY=$key" | Set-Content ".env" -Encoding utf8
    Write-Host "Created .env with a new API_KEY. Give that key to the web app admin (ESTIMATOR_API_KEY) over a private channel."
}

& $python scripts\verify_gpu.py
if ($LASTEXITCODE -ne 0) { throw "GPU check failed; fix the message above before installing the service." }
