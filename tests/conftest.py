import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

# Test configuration, set before app.py is imported. Not real secrets.
os.environ["API_KEY"] = "test-key-" + "x" * 40
os.environ["ALLOWED_ORIGINS"] = "https://app.vilchum.test"
os.environ["ALLOWED_ORIGIN_REGEX"] = ""
os.environ["MAX_UPLOAD_BYTES"] = str(2 * 1024 * 1024)
os.environ["REQUIRE_GPU"] = "false"
