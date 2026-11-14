import os
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

import app as service

KEY = os.environ["API_KEY"]
PHOTO = Path("my_photos") / "photo_2026-11-13_15-27-26.jpg"  # one plastic bottle held in a hand


@pytest.fixture(scope="module")
def client():
    with TestClient(service.app) as test_client:
        yield test_client


def jpeg(width=320, height=240):
    ok, buffer = cv2.imencode(".jpg", np.full((height, width, 3), 127, dtype=np.uint8))
    assert ok
    return buffer.tobytes()


# --- pure logic -------------------------------------------------------------------------------

def test_glass_bottles_are_not_accepted():
    assert service.classify("aluminium-cans") == "can"
    assert service.classify("plastic-bottle") == "bottle"
    assert service.classify("glass-bottle") is None
    assert service.classify("something-else") is None


def test_summary_counts_and_bands():
    items = [{"label": "can", "confidence": 0.92}, {"label": "can", "confidence": 0.81}, {"label": "bottle", "confidence": 0.77}]
    body = service.summarize(items, 0.5, {"glass_bottle": 2})
    assert body["status"] == "success"
    assert body["summary"] == {"cans": 2, "bottles": 1, "overall_confidence": "high", "min_confidence": 0.77, "not_accepted": {"glass_bottles": 2}}


def test_any_item_below_threshold_is_low_confidence():
    body = service.summarize([{"label": "can", "confidence": 0.95}, {"label": "bottle", "confidence": 0.49}], 0.5)
    assert body["status"] == "low_confidence"
    assert body["summary"]["overall_confidence"] == "low"


def test_no_items_is_success_with_zero_counts():
    body = service.summarize([], 0.5)
    assert body["status"] == "success"
    assert body["summary"]["cans"] == 0 and body["summary"]["bottles"] == 0
    assert body["summary"]["min_confidence"] is None


@pytest.mark.parametrize("env, message", [
    ({"API_KEY": "short"}, "API_KEY"),
    ({"ALLOWED_ORIGINS": "*"}, "Wildcard"),
    ({"ALLOWED_ORIGIN_REGEX": ".*"}, "Wildcard"),
    ({"ALLOWED_ORIGINS": "http://example.com"}, "not https"),
    ({"MODEL_PATH": "model/missing.pt"}, "Model file not found"),
])
def test_unsafe_configuration_refuses_to_start(monkeypatch, env, message):
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    with pytest.raises(RuntimeError, match=message):
        service.Settings().validate()


# --- HTTP, with the real model on whatever device is available ---------------------------------

def test_health_reports_model_and_device(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok" and body["model_loaded"] is True
    assert isinstance(body["gpu_active"], bool)


def test_detect_requires_the_api_key(client):
    files = {"image": ("a.jpg", jpeg(), "image/jpeg")}
    assert client.post("/detect", files=files).status_code == 401
    assert client.post("/detect", files=files, headers={"X-API-Key": "wrong"}).status_code == 401


def test_corrupt_and_missing_images_are_clean_400s(client):
    headers = {"X-API-Key": KEY}
    corrupt = client.post("/detect", headers=headers, files={"image": ("a.jpg", os.urandom(4000), "image/jpeg")})
    assert corrupt.status_code == 400 and corrupt.json() == {"error": "invalid_image"}
    empty = client.post("/detect", headers=headers, files={"image": ("a.jpg", b"", "image/jpeg")})
    assert empty.status_code == 400
    missing = client.post("/detect", headers=headers)
    assert missing.status_code == 400 and missing.json() == {"error": "image_required"}
    tiny = client.post("/detect", headers=headers, files={"image": ("a.jpg", jpeg(16, 16), "image/jpeg")})
    assert tiny.status_code == 400 and tiny.json() == {"error": "image_too_small"}
    # The server is still healthy after bad input.
    assert client.get("/health").status_code == 200


def test_oversized_upload_is_rejected(client):
    big = b"\xff\xd8" + os.urandom(3 * 1024 * 1024)
    response = client.post("/detect", headers={"X-API-Key": KEY}, files={"image": ("a.jpg", big, "image/jpeg")})
    assert response.status_code == 413


def test_blank_image_finds_nothing(client):
    response = client.post("/detect", headers={"X-API-Key": KEY}, files={"image": ("a.jpg", jpeg(), "image/jpeg")})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success" and body["items"] == []
    assert body["summary"]["cans"] == 0 and body["summary"]["bottles"] == 0


@pytest.mark.skipif(not PHOTO.exists(), reason="sample photo not present")
def test_real_photo_counts_one_plastic_bottle(client):
    response = client.post("/detect", headers={"X-API-Key": KEY}, files={"image": (PHOTO.name, PHOTO.read_bytes(), "image/jpeg")})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["summary"]["bottles"] == 1 and body["summary"]["cans"] == 0
    assert body["items"][0]["label"] == "bottle" and body["items"][0]["confidence"] >= 0.5
    assert body["meta"]["device"] in {"cuda", "cpu"}


@pytest.mark.skipif(not PHOTO.exists(), reason="sample photo not present")
def test_low_confidence_status_when_threshold_not_met(client, monkeypatch):
    monkeypatch.setattr(service.settings, "low_confidence_threshold", 0.99)
    response = client.post("/detect", headers={"X-API-Key": KEY}, files={"image": (PHOTO.name, PHOTO.read_bytes(), "image/jpeg")})
    body = response.json()
    assert body["status"] == "low_confidence"
    assert body["summary"]["overall_confidence"] == "low"


def test_cors_allows_only_configured_origins(client):
    preflight = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "X-API-Key"}
    allowed = client.options("/detect", headers={"Origin": "https://app.vilchum.test", **preflight})
    assert allowed.headers.get("access-control-allow-origin") == "https://app.vilchum.test"
    denied = client.options("/detect", headers={"Origin": "https://evil.example", **preflight})
    assert "access-control-allow-origin" not in denied.headers
    assert client.get("/health", headers={"Origin": "https://evil.example"}).headers.get("access-control-allow-origin") is None


def test_docs_are_not_exposed(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
