"""Check whether the Lemmings trainer can see an NVIDIA GPU.

This intentionally has no hard dependency on PyTorch yet. It reports the
driver-visible GPU first, then reports whether torch is installed and CUDA-ready.
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess


def run_nvidia_smi() -> str:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return "nvidia-smi: not found"

    try:
        result = subprocess.run(
            [exe, "--query-gpu=name,driver_version,memory.total,utilization.gpu", "--format=csv,noheader"],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as error:
        return f"nvidia-smi failed: {error.stderr.strip() or error}"

    return result.stdout.strip() or "nvidia-smi returned no GPUs"


def check_torch() -> str:
    if importlib.util.find_spec("torch") is None:
        return "torch: not installed"

    import torch  # type: ignore

    if not torch.cuda.is_available():
        return f"torch: installed {torch.__version__}, CUDA unavailable"

    device_count = torch.cuda.device_count()
    names = [torch.cuda.get_device_name(i) for i in range(device_count)]
    return f"torch: installed {torch.__version__}, CUDA available on {device_count} device(s): {', '.join(names)}"


def main() -> None:
    print("NVIDIA GPU")
    print(run_nvidia_smi())
    print()
    print("PyTorch")
    print(check_torch())


if __name__ == "__main__":
    main()
