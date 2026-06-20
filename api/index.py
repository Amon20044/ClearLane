"""
Vercel Python serverless entry point for the ClearLane API.

Vercel's @vercel/python runtime bundles this `api/` directory and detects the
module-level ASGI ``app``. The whole FastAPI app lives in the self-contained
``clearlane`` package right next to this file (no imports from outside `api/`),
so the function bundle is complete with zero-config — no custom includeFiles.

State lives in MongoDB (see clearlane/db.py) because Vercel's filesystem is
read-only — set MONGODB_URI / MONGODB_DB in the project's Environment Variables.
"""
import sys
from pathlib import Path

# ensure this directory is importable both on Vercel and when run locally
sys.path.insert(0, str(Path(__file__).resolve().parent))

from clearlane.main import app  # noqa: E402

# Vercel looks for a module-level ``app`` (ASGI). Keep this name.
__all__ = ["app"]
