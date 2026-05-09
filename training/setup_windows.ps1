param(
    [string]$VenvPath = ".venv-rl313",
    [string]$PythonExe = "python",
    [string]$TorchIndexUrl = "https://download.pytorch.org/whl/cu128"
)

$ErrorActionPreference = "Stop"

Write-Host "Creating Python RL environment at $VenvPath"
& $PythonExe -m venv $VenvPath

$python = Join-Path $VenvPath "Scripts/python.exe"

& $python -m pip install --upgrade pip
& $python -m pip install torch torchvision torchaudio --index-url $TorchIndexUrl
& $python -m pip install -r training/requirements.txt
& $python training/gpu_check.py

Write-Host ""
Write-Host "RL Python environment ready."
Write-Host "Use: $python training/train_skeleton.py --device cuda"
