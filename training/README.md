# GPU Training Plan

The current browser lab is a visual playground. It runs the game simulation in browser iframes, so it mostly uses CPU. The GPU becomes useful when we add the actual neural-network trainer.

## Intended Split

- Browser lab: entertaining replay, action markers, reward readouts, side-by-side attempts.
- JS simulation workers: fast deterministic Lemmings rollouts from MLM/INI levels.
- Python trainer: policy/value network updates on CUDA with PyTorch.
- Replay stream: best or weirdest attempts sent back to the browser dashboard.

This is the right shape because Lemmings physics is branchy game logic and does not map cleanly to GPU kernels, while the neural network absolutely does.

## Current Machine Check

Run:

```powershell
python training/gpu_check.py
```

Expected result on this machine: `nvidia-smi` sees the RTX 5070. PyTorch is not installed yet in the current Python environment, so the GPU is visible but not trainable until we install a CUDA-enabled PyTorch build.

## Setup

From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File training/setup_windows.ps1
```

That creates `.venv-rl313`, installs CUDA PyTorch, installs the lightweight trainer dependencies, and runs the GPU check.

Smoke-test the trainer skeleton:

```powershell
.venv-rl313\Scripts\python.exe training/train_skeleton.py --device cuda
```

## Browser Bridge

Start the GPU trainer bridge:

```powershell
.venv-rl313\Scripts\python.exe training\trainer_bridge.py --device cuda
```

Then refresh `public/ai-lab.html`. The dashboard should show the `GPU Trainer`
counter climbing as browser runs connect.

## Trainer Direction

The first useful GPU trainer should:

1. Keep many CPU rollout environments running.
2. Batch observations into tensors.
3. Run policy inference/training on `cuda`.
4. Return sampled actions to the JS environments.
5. Save replay traces for the browser lab.

That means we should avoid trying to run the whole game on GPU. We want the GPU doing the dense math, not pretending to be a Master System collision engine.
