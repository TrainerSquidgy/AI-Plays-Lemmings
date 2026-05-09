# Trainer Bridge

The browser lab currently runs visual JavaScript rollouts. The Python trainer should not drive the visible UI directly. Instead, it should receive compact observations from many JS workers, batch them on the GPU, and return actions.

## Observation Sketch

The current browser environment exposes:

```js
window.lemmingsRLEnv.getObservation()
```

The first bridge should compress that into a fixed-size vector:

- normalized level id / curriculum index
- timer and release rate
- remaining skill counts
- per-lemming slots: x, y, direction, state, climber/floater flags
- exit and hatch positions
- local terrain probes around each candidate lemming
- reachability features from `estimateRoutePotential`

## Action Sketch

Discrete action:

```text
0 = wait
1..8 = assign skill
```

Target selection can initially be heuristic: choose the lemming with the best local urgency score for that action. Later, the network can emit both action type and target slot.

## Comfortable GPU Plan

Keep the GPU doing batched neural-network work and cap background work so the PC stays usable:

- visual browser runs: 10 by default
- hidden JS rollout workers: start at 32
- policy batch size: 512
- target GPU memory: below 4 GB for training
- target GPU utilization: below roughly 50% until the UI feels comfortable
