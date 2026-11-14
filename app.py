"""VilChum object-recognition service.

Counts cans and bottles in a photo with the custom YOLO model in ./model/best.pt.
The result is an ESTIMATE only: VilChum never credits points from it. A driver's
verified weight is what becomes spendable balance.

Security model
- Every /detect request needs X-API-Key (checked before the upload is read).
- CORS is closed unless ALLOWED_ORIGINS / ALLOWED_ORIGIN_REGEX are set. The
  VilChum web app calls this service from its server, so browsers never need
  (or get) the key. Wildcard origins are refused at startup.
- Photos are decoded in memory and never written to disk or logged.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv

load_dotenv()

# Must be set before cv2 is imported: caps decoded image size (decompression bombs).
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", str(int(os.getenv("MAX_IMAGE_PIXELS", "40000000"))))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
from fastapi import FastAPI, File, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from starlette.concurrency import run_in_threadpool  # noqa: E402

log = logging.getLogger("vilchum.detect")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")

SERVICE_VERSION = "1.0.0"


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be a number") from error


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be a whole number") from error


class Settings:
    def __init__(self) -> None:
        self.api_key = os.getenv("API_KEY", "")
        self.allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "").split(",") if origin.strip()]
        self.allowed_origin_regex = os.getenv("ALLOWED_ORIGIN_REGEX", "").strip() or None
        self.model_path = os.getenv("MODEL_PATH", os.path.join("model", "best.pt"))
        # Detections below DETECTION_FLOOR are discarded; detections between the floor and
        # LOW_CONFIDENCE_THRESHOLD are kept and mark the whole result "low_confidence".
        self.detection_floor = _float("DETECTION_FLOOR", 0.25)
        self.low_confidence_threshold = _float("LOW_CONFIDENCE_THRESHOLD", 0.50)
        self.iou = _float("IOU_THRESHOLD", 0.5)
        self.image_size = _int("IMAGE_SIZE", 640)
        self.max_upload_bytes = _int("MAX_UPLOAD_BYTES", 12 * 1024 * 1024)
        self.max_queue = _int("MAX_QUEUE", 8)
        self.require_gpu = os.getenv("REQUIRE_GPU", "false").lower() == "true"
        self.enable_docs = os.getenv("ENABLE_DOCS", "false").lower() == "true"

    def validate(self) -> None:
        problems = []
        if len(self.api_key) < 32:
            problems.append("API_KEY must be set to at least 32 random characters (python -c \"import secrets; print(secrets.token_urlsafe(48))\").")
        if "*" in self.allowed_origins or self.allowed_origin_regex in {".*", "*"}:
            problems.append("Wildcard CORS origins are forbidden. List exact origins in ALLOWED_ORIGINS.")
        for origin in self.allowed_origins:
            if not origin.startswith(("https://", "http://localhost", "http://127.0.0.1")):
                problems.append(f"ALLOWED_ORIGINS entry is not https: {origin}")
        if not 0 < self.detection_floor <= self.low_confidence_threshold < 1:
            problems.append("Need 0 < DETECTION_FLOOR <= LOW_CONFIDENCE_THRESHOLD < 1.")
        if not os.path.isfile(self.model_path):
            problems.append(f"Model file not found at {os.path.abspath(self.model_path)}")
        if problems:
            raise RuntimeError("Refusing to start:\n- " + "\n- ".join(problems))


settings = Settings()


# Exact model class -> product material. Only these two earn points; glass bottles are
# detected but NOT accepted (rates are for aluminium cans and plastic bottles).
ACCEPTED_CLASSES = {"aluminium-cans": "can", "plastic-bottle": "bottle"}
REJECTED_CLASSES = {"glass-bottle": "glass_bottle"}


def classify(label: str) -> str | None:
    """Accepted material for a model class name, or None (rejected or unknown)."""
    return ACCEPTED_CLASSES.get(label.strip().lower())


class Detector:
    def __init__(self) -> None:
        self.model: Any = None
        self.device: str | int = "cpu"
        self.gpu_active = False
        self.gpu_name: str | None = None
        self.model_loaded = False
        self.load_error: str | None = None
        self.class_names: dict[int, str] = {}
        self.lock = asyncio.Lock()
        self.waiting = 0

    def load(self) -> None:
        from ultralytics import YOLO

        if torch.cuda.is_available():
            self.device = 0
            self.gpu_name = torch.cuda.get_device_name(0)
            capability = "sm_%d%d" % torch.cuda.get_device_capability(0)
            supported = torch.cuda.get_arch_list()
            if capability not in supported:
                # e.g. an RTX 50-series (sm_120) with a CUDA 12.1 build of PyTorch.
                raise RuntimeError(
                    f"PyTorch {torch.__version__} was built for {supported} but the GPU ({self.gpu_name}) is {capability}. "
                    "Install a build that supports it (RTX 50-series: pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128)."
                )
        elif settings.require_gpu:
            raise RuntimeError("REQUIRE_GPU=true but CUDA is not available. Install the CUDA build of PyTorch (see README).")

        self.model = YOLO(settings.model_path)
        self.class_names = {int(key): str(value) for key, value in self.model.names.items()}
        missing = set(ACCEPTED_CLASSES) - {name.lower() for name in self.class_names.values()}
        if missing:
            # A swapped or retrained model with different class names would silently count nothing.
            raise RuntimeError(f"Model classes {sorted(self.class_names.values())} do not include required {sorted(missing)}.")
        # Warm-up: the first CUDA inference is slow; do it now, not on a user's photo.
        self.model.predict(np.zeros((settings.image_size, settings.image_size, 3), dtype=np.uint8), device=self.device, verbose=False, imgsz=settings.image_size)
        self.model_loaded = True
        self.gpu_active = self.device == 0
        if self.gpu_active:
            log.info("🔥 GPU ACTIVE: %s (CUDA %s, torch %s)", self.gpu_name, torch.version.cuda, torch.__version__)
        else:
            banner = "!" * 78
            log.warning("\n%s\n!! RUNNING ON CPU. CUDA is not available (torch %s, CUDA build: %s).\n!! Detection will be 10-50x slower and requests will time out under load.\n!! Fix: install the CUDA build of PyTorch (README, step 3), then restart.\n%s",
                        banner, torch.__version__, torch.version.cuda, banner)
        log.info("Model loaded from %s with classes %s", settings.model_path, self.class_names)

    def predict(self, image: np.ndarray) -> tuple[list[dict[str, Any]], dict[str, int]]:
        results = self.model.predict(image, device=self.device, conf=settings.detection_floor, iou=settings.iou,
                                     imgsz=settings.image_size, verbose=False)
        items: list[dict[str, Any]] = []
        rejected: dict[str, int] = {}
        for result in results:
            boxes = result.boxes
            if boxes is None:
                continue
            for cls, conf in zip(boxes.cls.tolist(), boxes.conf.tolist()):
                name = self.class_names.get(int(cls), "").lower()
                label = classify(name)
                if label:
                    items.append({"label": label, "confidence": round(float(conf), 4)})
                elif name in REJECTED_CLASSES and conf >= settings.low_confidence_threshold:
                    key = REJECTED_CLASSES[name]
                    rejected[key] = rejected.get(key, 0) + 1
        items.sort(key=lambda item: item["confidence"], reverse=True)
        return items, rejected


detector = Detector()


def summarize(items: list[dict[str, Any]], threshold: float, rejected: dict[str, int] | None = None) -> dict[str, Any]:
    """Builds the public response. Pure function, unit-tested.

    status is "low_confidence" when any accepted item is below the threshold. Zero items is
    still "success" with zero counts; the caller decides how to tell the user nothing was found.
    """
    low = any(item["confidence"] < threshold for item in items)
    confidences = [item["confidence"] for item in items]
    return {
        "status": "low_confidence" if low else "success",
        "items": items,
        "summary": {
            "cans": sum(1 for item in items if item["label"] == "can"),
            "bottles": sum(1 for item in items if item["label"] == "bottle"),
            "overall_confidence": "low" if low else "high",
            "min_confidence": min(confidences) if confidences else None,
            "not_accepted": {"glass_bottles": (rejected or {}).get("glass_bottle", 0)},
        },
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.validate()
    try:
        await run_in_threadpool(detector.load)
    except Exception as error:  # keep serving /health so monitoring can see why
        detector.load_error = str(error)
        log.error("Model failed to load: %s", error)
        if settings.require_gpu:
            raise
    yield


app = FastAPI(title="VilChum detect", version=SERVICE_VERSION, lifespan=lifespan,
              docs_url="/docs" if settings.enable_docs else None, redoc_url=None,
              openapi_url="/openapi.json" if settings.enable_docs else None)

if settings.allowed_origins or settings.allowed_origin_regex:
    app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_origin_regex=settings.allowed_origin_regex,
                       allow_methods=["POST", "GET"], allow_headers=["X-API-Key", "Content-Type"], allow_credentials=False, max_age=600)


@app.middleware("http")
async def require_api_key(request: Request, call_next):
    """Rejects unauthenticated /detect calls before the upload body is read."""
    if request.url.path == "/detect" and request.method != "OPTIONS":
        supplied = request.headers.get("x-api-key", "")
        if not supplied or not hmac.compare_digest(supplied.encode(), settings.api_key.encode()):
            return JSONResponse(status_code=401, content={"error": "unauthorized"})
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > settings.max_upload_bytes + 64 * 1024:
            return JSONResponse(status_code=413, content={"error": "image_too_large"})
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_error(_: Request, error: HTTPException):
    return JSONResponse(status_code=error.status_code, content={"error": error.detail})


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, __: RequestValidationError):
    return JSONResponse(status_code=400, content={"error": "image_required"})


@app.exception_handler(Exception)
async def unexpected_error(request: Request, error: Exception):
    # Never leak internals or crash the worker; the photo itself is not logged.
    log.exception("Unhandled error on %s %s: %s", request.method, request.url.path, type(error).__name__)
    return JSONResponse(status_code=500, content={"error": "internal_error"})


@app.get("/health")
async def health():
    ready = detector.model_loaded
    body = {"status": "ok" if ready else "degraded", "gpu_active": detector.gpu_active, "model_loaded": ready,
            "device": "cuda" if detector.gpu_active else "cpu", "version": SERVICE_VERSION}
    if detector.load_error:
        body["error"] = "model_load_failed"
    return JSONResponse(status_code=200 if ready else 503, content=body)


@app.post("/detect")
async def detect(image: UploadFile = File(...)):
    if not detector.model_loaded:
        raise HTTPException(status_code=503, detail="model_unavailable")
    data = await image.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="image_too_large")
    if not data:
        raise HTTPException(status_code=400, detail="image_required")
    decoded = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if decoded is None or decoded.size == 0:
        raise HTTPException(status_code=400, detail="invalid_image")
    height, width = decoded.shape[:2]
    if min(height, width) < 32:
        raise HTTPException(status_code=400, detail="image_too_small")

    # One GPU: run inferences one at a time and shed load instead of queueing forever.
    if detector.waiting >= settings.max_queue:
        raise HTTPException(status_code=503, detail="busy")
    detector.waiting += 1
    try:
        async with detector.lock:
            started = time.perf_counter()
            items, rejected = await run_in_threadpool(detector.predict, decoded)
            elapsed_ms = round((time.perf_counter() - started) * 1000)
    finally:
        detector.waiting -= 1

    body = summarize(items, settings.low_confidence_threshold, rejected)
    body["meta"] = {"inference_ms": elapsed_ms, "device": "cuda" if detector.gpu_active else "cpu", "version": SERVICE_VERSION}
    return body
