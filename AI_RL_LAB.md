# Lemmings RL Lab

This repo now has a first reinforcement-learning playground scaffold. It is not a trained model yet; it is the environment boundary and a visual curiosity runner that lets many attempts play at once.

## Browser Lab

Start the existing server:

```powershell
npm start
```

Then open:

```text
http://localhost:3004/ai-lab.html
```

The lab embeds multiple copies of the existing game engine. Each run loads the requested MLM/INI level, starts play automatically, assigns random curiosity-driven skill experiments, records reward, and restarts after the attempt ends.

Useful URLs:

```text
http://localhost:3004/ai-lab.html?level=FUN_01&runs=9
http://localhost:3004/index.html?rl=1&rlLevel=FUN_01&rlSpeed=10
```

## Environment API

When `index.html` is loaded with `?rl=1`, `public/js/rl-environment.js` exposes:

```js
window.lemmingsRLEnv.getObservation()
window.lemmingsRLEnv.getPublicState()
window.lemmingsRLEnv.applySkill(skill, lemming, reason)
window.lemmingsRLEnv.reset()
```

The current reward scaffold is deliberately simple:

- saved lemming: large positive reward
- death animation/dead state: penalty
- newly visited map tiles: small curiosity reward
- movement toward the nearest exit: small shaping reward

## Next Step

The next useful layer is a Python trainer bridge. The browser lab proves the environment shape and visual replay first; the trainer can later connect through WebSocket or Playwright, run headless attempts, and send action decisions back into this same API.

## GPU Note

The visual lab is CPU-heavy because each tile is a real browser/game simulation. The GPU should be used by the Python policy/value network, while CPU workers run the deterministic Lemmings rollouts.

This machine sees an NVIDIA RTX 5070 through `nvidia-smi`. The current Python environment does not yet have PyTorch/NumPy/Gymnasium installed, so the next setup step is a CUDA-enabled Python trainer environment.

Run:

```powershell
python training/gpu_check.py
```

The planned split is:

- JS/browser: watchable replays and side-by-side attempts
- JS/headless workers: fast game rollouts
- Python/PyTorch: GPU policy inference and training
- dashboard: receives replay traces from interesting attempts

The browser lab now uses a theater layout: one spotlight run on top with audio,
and the nine most promising contender runs underneath. Extra browser runs can
continue offscreen, but true comfortable background volume should come from the
future Python/CUDA worker pool rather than dozens of visible browser iframes.

## Curriculum

RL runs auto-advance by default. A run advances when it saves at least the larger of:

- the level's own `percent_needed`
- `60%`, the current mastery floor

Useful overrides:

```text
?rlAutoAdvance=0
?rlMasteryThreshold=80
?rlMute=0
```
