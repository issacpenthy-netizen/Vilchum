# Installs the detection service as a Windows service that starts at boot and restarts on crash.
# Run in an ADMINISTRATOR PowerShell from the repository root:
#   powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 -Nssm "C:\tools\nssm\win64\nssm.exe"

param(
    [Parameter(Mandatory = $true)][string]$Nssm,
    [string]$Name = "VilChumDetect",
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $Nssm)) { throw "nssm.exe not found at $Nssm (download from https://nssm.cc/download)" }
if (-not (Test-Path $python)) { throw "Run scripts\setup.ps1 first." }
if (-not (Test-Path (Join-Path $root ".env"))) { throw ".env is missing. Run scripts\setup.ps1 first." }
New-Item -ItemType Directory -Force (Join-Path $root "logs") | Out-Null

if (Get-Service $Name -ErrorAction SilentlyContinue) {
    & $Nssm stop $Name | Out-Null
    & $Nssm remove $Name confirm | Out-Null
}

# Bind to 127.0.0.1 only: the Cloudflare Tunnel connects locally; nothing on the LAN or internet
# can reach the port directly. One worker: one GPU, inference is serialised in-process.
& $Nssm install $Name $python "-m uvicorn app:app --host 127.0.0.1 --port $Port --workers 1 --no-server-header --timeout-graceful-shutdown 10"
& $Nssm set $Name AppDirectory $root
& $Nssm set $Name DisplayName "VilChum detection (YOLO)"
& $Nssm set $Name Description "Counts cans and bottles for VilChum estimates. Reached only through Cloudflare Tunnel."
& $Nssm set $Name Start SERVICE_DELAYED_AUTO_START      # wait for the GPU driver and network after boot
& $Nssm set $Name AppExit Default Restart
& $Nssm set $Name AppRestartDelay 5000
& $Nssm set $Name AppThrottle 15000
& $Nssm set $Name AppStdout (Join-Path $root "logs\service.log")
& $Nssm set $Name AppStderr (Join-Path $root "logs\service.log")
& $Nssm set $Name AppRotateFiles 1
& $Nssm set $Name AppRotateOnline 1
& $Nssm set $Name AppRotateBytes 10485760
& $Nssm set $Name AppEnvironmentExtra "PYTHONUNBUFFERED=1" "PYTHONIOENCODING=utf-8"

& $Nssm start $Name
Start-Sleep -Seconds 20
try {
    $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 10
    Write-Host ("Health: status={0} gpu_active={1} model_loaded={2}" -f $health.status, $health.gpu_active, $health.model_loaded)
    if (-not $health.gpu_active) { Write-Warning "Service is running on CPU. Check logs\service.log." }
} catch {
    Write-Warning "Service did not answer yet. Check logs\service.log, then: Invoke-RestMethod http://127.0.0.1:$Port/health"
}
