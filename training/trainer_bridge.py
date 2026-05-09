"""WebSocket GPU trainer bridge for the browser RL lab.

Run this first:

    .venv-rl313\\Scripts\\python.exe training\\trainer_bridge.py --device cuda

Then refresh ai-lab.html. Browser runs will connect to ws://127.0.0.1:8765
and ask this process for actions.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
from dataclasses import dataclass
from typing import Any

import torch
import websockets
from torch import nn


LOGGER = logging.getLogger("lemmings.trainer_bridge")


SKILLS = [
    "climber",
    "floater",
    "bomber",
    "blocker",
    "builder",
    "basher",
    "miner",
    "digger",
]

STATE_IDS = {
    "falling": 1,
    "walking": 2,
    "climbing": 3,
    "floating": 4,
    "building": 5,
    "shrugging": 6,
    "bashing": 7,
    "mining": 8,
    "digging": 9,
    "blocking": 10,
    "exploding": 11,
    "drowning": 12,
    "burning": 13,
    "splatting": 14,
    "exiting": 15,
    "saved": 16,
    "dead": 17,
}

RATINGS = ["FUN", "TRICKY", "TAXING", "MAYHEM", "EXTRA1", "EXTRA2", "EXTRA3", "EXTRA4"]


@dataclass(frozen=True)
class BridgeConfig:
    obs_dim: int = 128
    action_dim: int = 9
    hidden_dim: int = 256
    temperature: float = 1.15
    learning_rate: float = 3e-4


class PolicyNet(nn.Module):
    def __init__(self, config: BridgeConfig) -> None:
        super().__init__()
        self.trunk = nn.Sequential(
            nn.Linear(config.obs_dim, config.hidden_dim),
            nn.ReLU(),
            nn.Linear(config.hidden_dim, config.hidden_dim),
            nn.ReLU(),
        )
        self.policy = nn.Linear(config.hidden_dim, config.action_dim)
        self.value = nn.Linear(config.hidden_dim, 1)

    def forward(self, obs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        features = self.trunk(obs)
        return self.policy(features), self.value(features).squeeze(-1)


def number(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def level_rank(level_id: str) -> float:
    text = str(level_id or "FUN_01").upper()
    if "_" not in text:
        return 0.0
    rating, raw_num = text.rsplit("_", 1)
    try:
        num = int(raw_num)
    except ValueError:
        num = 1
    rating_index = RATINGS.index(rating) if rating in RATINGS else 0
    return (rating_index * 30 + max(1, min(30, num))) / 240.0


def encode_observation(obs: dict[str, Any], obs_dim: int) -> torch.Tensor:
    values: list[float] = []

    stats = obs.get("stats") or {}
    skills = obs.get("skillCounts") or {}
    lemmings = obs.get("lemmings") or []
    exits = obs.get("exits") or []
    entrances = obs.get("entrances") or []

    total = max(1.0, number(stats.get("lemmingsOut"), 0) + number(stats.get("lemmingsLeftToSpawn"), 0))

    values.extend(
        [
            level_rank(str(obs.get("level") or "")),
            number(obs.get("reward")) / 1000.0,
            number(obs.get("lastReward")) / 50.0,
            number(obs.get("bestReachabilityScore")) / 1000.0,
            number(stats.get("lemmingsSaved")) / max(1.0, number(stats.get("lemmingsOut"), 1)),
            number(stats.get("lemmingsLeftToSpawn")) / total,
            number(stats.get("timeElapsed")) / 6000.0,
            number(obs.get("releaseRate")) / 99.0,
        ]
    )

    for skill in SKILLS:
        values.append(number(skills.get(skill)) / 20.0)

    for lemming in list(lemmings)[:10]:
        state = str(lemming.get("state") or "")
        values.extend(
            [
                number(lemming.get("x")) / 896.0,
                number(lemming.get("y")) / 224.0,
                number(lemming.get("direction")) / 1.0,
                STATE_IDS.get(state, 0) / 20.0,
                1.0 if lemming.get("isClimber") else 0.0,
                1.0 if lemming.get("isFloater") else 0.0,
                number(lemming.get("buildCount")) / 12.0,
            ]
        )

    for _ in range(max(0, 10 - len(lemmings))):
        values.extend([0.0] * 7)

    for exit_pos in list(exits)[:3]:
        values.extend([number(exit_pos.get("x")) / 896.0, number(exit_pos.get("y")) / 224.0])

    for _ in range(max(0, 3 - len(exits))):
        values.extend([0.0, 0.0])

    for entrance in list(entrances)[:2]:
        values.extend([number(entrance.get("x")) / 896.0, number(entrance.get("y")) / 224.0])

    if len(values) < obs_dim:
        values.extend([0.0] * (obs_dim - len(values)))

    return torch.tensor(values[:obs_dim], dtype=torch.float32)


class TrainerBridge:
    def __init__(self, device: torch.device, config: BridgeConfig) -> None:
        self.device = device
        self.config = config
        self.model = PolicyNet(config).to(device)
        self.optimizer = torch.optim.AdamW(self.model.parameters(), lr=config.learning_rate)
        self.pending: dict[str, tuple[torch.Tensor, torch.Tensor, int]] = {}
        self.decisions = 0
        self.updates = 0

    def action_mask(self, obs: dict[str, Any]) -> torch.Tensor:
        skills = obs.get("skillCounts") or {}
        mask = torch.zeros(self.config.action_dim, dtype=torch.bool, device=self.device)
        mask[0] = True
        for index, skill in enumerate(SKILLS, start=1):
            mask[index] = number(skills.get(skill)) > 0
        return mask

    def learn_from_reward(self, client_id: str, reward_delta: float) -> None:
        pending = self.pending.pop(client_id, None)
        if pending is None:
            return

        encoded_cpu, mask_cpu, action_index = pending
        encoded = encoded_cpu.to(self.device).unsqueeze(0)
        mask = mask_cpu.to(self.device)

        logits, values = self.model(encoded)
        logits = logits.squeeze(0) / self.config.temperature
        logits = logits.masked_fill(~mask, -1e9)
        dist = torch.distributions.Categorical(logits=logits)
        log_prob = dist.log_prob(torch.tensor(action_index, device=self.device))
        value = values.squeeze(0)

        reward = torch.tensor(float(max(-10.0, min(10.0, reward_delta))), device=self.device)
        advantage = reward - value.detach()
        policy_loss = -log_prob * advantage
        value_loss = nn.functional.mse_loss(value, reward)
        loss = policy_loss + 0.5 * value_loss

        self.optimizer.zero_grad(set_to_none=True)
        loss.backward()
        self.optimizer.step()
        self.updates += 1

    def decide(self, client_id: str, obs: dict[str, Any]) -> dict[str, Any]:
        self.learn_from_reward(client_id, number(obs.get("lastReward")))

        encoded_cpu = encode_observation(obs, self.config.obs_dim)
        encoded = encoded_cpu.to(self.device).unsqueeze(0)
        logits, values = self.model(encoded)
        logits = logits.squeeze(0) / self.config.temperature
        mask = self.action_mask(obs)
        logits = logits.masked_fill(~mask, -1e9)
        dist = torch.distributions.Categorical(logits=logits)
        action_index = int(dist.sample().item())

        self.pending[client_id] = (encoded_cpu, mask.detach().cpu(), action_index)
        self.decisions += 1

        skill = "wait" if action_index == 0 else SKILLS[action_index - 1]
        return {
            "type": "action",
            "actionIndex": action_index,
            "skill": skill,
            "reason": "gpu trainer",
            "decisions": self.decisions,
            "updates": self.updates,
        }


async def handle_client(websocket: websockets.ServerConnection, bridge: TrainerBridge) -> None:
    try:
        async for raw in websocket:
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if message.get("type") != "decision":
                continue

            client_id = str(message.get("clientId") or "unknown")
            obs = message.get("observation") or {}
            response = bridge.decide(client_id, obs)
            response["requestId"] = message.get("requestId")
            await websocket.send(json.dumps(response))
    except websockets.exceptions.ConnectionClosed:
        return
    except Exception:
        LOGGER.exception("trainer client failed")


def configure_logging(verbose_websockets: bool = False) -> None:
    logging.basicConfig(format="%(message)s", level=logging.INFO)
    if not verbose_websockets:
        for name in ("websockets", "websockets.server"):
            logging.getLogger(name).setLevel(logging.CRITICAL)


async def main_async() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    parser.add_argument("--verbose-websockets", action="store_true")
    args = parser.parse_args()

    configure_logging(args.verbose_websockets)

    if args.device == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA requested, but PyTorch cannot see a CUDA GPU.")

    device = torch.device(args.device)
    bridge = TrainerBridge(device, BridgeConfig())
    print(f"trainer bridge listening on ws://{args.host}:{args.port}")
    print(f"device={device}")
    if device.type == "cuda":
        print(f"gpu={torch.cuda.get_device_name(0)}")

    async with websockets.serve(lambda ws: handle_client(ws, bridge), args.host, args.port):
        await asyncio.Future()


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
