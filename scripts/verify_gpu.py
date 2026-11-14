"""Checks that PyTorch can really use the GPU before the service is installed.

Run from the repository root:  .venv\\Scripts\\python scripts\\verify_gpu.py
Exit code 0 = the GPU works with this PyTorch build; 1 = it does not (the message says why).
"""

import sys
import time

import torch


def fail(message: str) -> None:
    print(f"\nFAIL: {message}")
    sys.exit(1)


print(f"torch {torch.__version__} | CUDA build {torch.version.cuda} | cuda available {torch.cuda.is_available()}")
if torch.version.cuda is None:
    fail("This is the CPU-only build of PyTorch. Reinstall with:\n"
         "  pip install --force-reinstall torch torchvision --index-url https://download.pytorch.org/whl/cu128")
if not torch.cuda.is_available():
    fail("PyTorch has CUDA support but cannot see the GPU. Update the NVIDIA driver (RTX 50-series needs 570 or newer), then reboot.")

name = torch.cuda.get_device_name(0)
capability = "sm_%d%d" % torch.cuda.get_device_capability(0)
arch_list = torch.cuda.get_arch_list()
print(f"GPU {name} | compute capability {capability} | this build supports {arch_list}")
if capability not in arch_list:
    fail(f"This PyTorch build has no kernels for {capability}. RTX 50-series (sm_120) needs the cu128 build or newer.")

try:
    x = torch.randn(2048, 2048, device="cuda")
    torch.cuda.synchronize()
    started = time.perf_counter()
    for _ in range(20):
        x = x @ x
        x = x / x.norm()
    torch.cuda.synchronize()
    print(f"GPU matrix test OK ({(time.perf_counter() - started) * 1000:.0f} ms)")
except RuntimeError as error:
    fail(f"GPU computation failed: {error}")

try:
    from pathlib import Path

    import numpy as np
    from ultralytics import YOLO

    model_path = Path("model") / "best.pt"
    model = YOLO(str(model_path))
    frame = np.zeros((640, 640, 3), dtype=np.uint8)
    model.predict(frame, device=0, verbose=False)  # warm-up
    started = time.perf_counter()
    model.predict(frame, device=0, verbose=False)
    print(f"YOLO on GPU OK: {(time.perf_counter() - started) * 1000:.0f} ms per image | classes {model.names}")
except Exception as error:  # noqa: BLE001
    fail(f"YOLO inference on the GPU failed: {error}")

print("\n🔥 GPU ready. You can install the service.")
