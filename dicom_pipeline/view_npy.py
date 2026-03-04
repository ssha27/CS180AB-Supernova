import glob, os
import numpy as np
import matplotlib.pyplot as plt

series = sorted(glob.glob("out/series_*/"))[0]
path = os.path.join(series, "image.npy")

x = np.load(path)  # (1, D, H, W)
print("Loaded:", path)
print("shape:", x.shape, "dtype:", x.dtype, "min/max:", x.min(), x.max())

# show middle slice
mid = x.shape[1] // 2
img = x[0, mid]

plt.imshow(img, cmap="gray")
plt.title(f"Middle slice (D={x.shape[1]})")
plt.axis("off")
plt.show()