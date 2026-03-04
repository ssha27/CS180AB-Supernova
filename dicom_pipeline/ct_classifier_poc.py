import os, glob
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader


# Config
DATA_GLOB = "out/series_*/image.npy"  
LABEL = 1  # pretend "cancer" for this one sample (placeholder)
DEVICE = "cpu"


# Dataset
class SingleCTSliceDataset(Dataset):
    """
    Loads (1, D, H, W) from image.npy
    For this, we take the middle slice and treat it as a 2D image (1, H, W)
    """
    def __init__(self, paths, label):
        self.paths = paths
        self.label = float(label)

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, idx):
        x = np.load(self.paths[idx]).astype(np.float32)   # (1, D, H, W)
        x = x[0]  # (D, H, W)
        mid = x.shape[0] // 2
        x2d = x[mid][None, ...]  # (1, H, W) channel=1

        y = np.array([self.label], dtype=np.float32)  # binary label
        return torch.from_numpy(x2d), torch.from_numpy(y)


# Basic 2D CNN
class SmallCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(1, 8, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),       # 512 -> 256
            nn.Conv2d(8, 16, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),       # 256 -> 128
            nn.Conv2d(16, 32, 3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((1, 1)),  # -> (B, 32, 1, 1)
            nn.Flatten(),                  # -> (B, 32)
            nn.Linear(32, 1)               # logits
        )

    def forward(self, x):
        return self.net(x)


def main():
    paths = sorted(glob.glob(DATA_GLOB))
    if not paths:
        raise FileNotFoundError(f"No files matched {DATA_GLOB}. Did you run ingestion?")

    ds = SingleCTSliceDataset(paths, LABEL)
    dl = DataLoader(ds, batch_size=1, shuffle=True)

    model = SmallCNN().to(DEVICE)
    criterion = nn.BCEWithLogitsLoss()
    optim = torch.optim.Adam(model.parameters(), lr=1e-3)

    model.train()
    for step, (x, y) in enumerate(dl):
        x, y = x.to(DEVICE), y.to(DEVICE)  # x: (B,1,H,W), y: (B,1)

        logits = model(x)
        loss = criterion(logits, y)

        optim.zero_grad()
        loss.backward()
        optim.step()

        prob = torch.sigmoid(logits).item()
        print(f"step={step} loss={loss.item():.4f} prob={prob:.4f} x_shape={tuple(x.shape)}")


        break

    print("End-to-end worked (load -> model -> loss -> backward -> update)")


if __name__ == "__main__":
    main()