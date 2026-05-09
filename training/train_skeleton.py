"""GPU-first trainer skeleton for the Lemmings RL project.

This is deliberately small: it verifies CUDA, builds a policy/value network,
and runs a synthetic batch through it. The next step is connecting rollout
observations from JS workers to the `make_fake_batch` shape used here.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import numpy as np
import torch
from torch import nn


@dataclass(frozen=True)
class TrainerConfig:
    batch_size: int = 512
    obs_dim: int = 128
    action_dim: int = 9  # wait + 8 skills
    hidden_dim: int = 256


class LemmingsPolicy(nn.Module):
    def __init__(self, obs_dim: int, action_dim: int, hidden_dim: int) -> None:
        super().__init__()
        self.trunk = nn.Sequential(
            nn.Linear(obs_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
        )
        self.policy = nn.Linear(hidden_dim, action_dim)
        self.value = nn.Linear(hidden_dim, 1)

    def forward(self, obs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        features = self.trunk(obs)
        return self.policy(features), self.value(features).squeeze(-1)


def make_fake_batch(config: TrainerConfig, device: torch.device) -> torch.Tensor:
    # Placeholder until JS rollout workers feed real observations.
    data = np.random.normal(size=(config.batch_size, config.obs_dim)).astype("float32")
    return torch.from_numpy(data).to(device)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    parser.add_argument("--batch-size", type=int, default=512)
    args = parser.parse_args()

    if args.device == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA requested, but torch.cuda.is_available() is false.")

    device = torch.device(args.device)
    config = TrainerConfig(batch_size=args.batch_size)
    model = LemmingsPolicy(config.obs_dim, config.action_dim, config.hidden_dim).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4)

    obs = make_fake_batch(config, device)
    logits, values = model(obs)
    fake_actions = torch.randint(0, config.action_dim, (config.batch_size,), device=device)
    fake_returns = torch.randn(config.batch_size, device=device)

    policy_loss = nn.functional.cross_entropy(logits, fake_actions)
    value_loss = nn.functional.mse_loss(values, fake_returns)
    loss = policy_loss + 0.5 * value_loss

    optimizer.zero_grad(set_to_none=True)
    loss.backward()
    optimizer.step()

    print(f"device={device}")
    if device.type == "cuda":
        print(f"gpu={torch.cuda.get_device_name(0)}")
        print(f"allocated_mb={torch.cuda.memory_allocated(0) / (1024 * 1024):.1f}")
    print(f"batch_size={config.batch_size}")
    print(f"policy_shape={tuple(logits.shape)} value_shape={tuple(values.shape)}")
    print(f"loss={loss.item():.4f}")


if __name__ == "__main__":
    main()
