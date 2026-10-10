# Barcelona Flood Physics Engine (Milestone 1)
    python -m venv .venv && .venv/bin/pip install -e ".[dev]"
    .venv/bin/ruff check . && .venv/bin/pytest -q
    .venv/bin/uvicorn bcnflood.api.main:app --port 8000
See docs/first_task_report.md. No Barcelona results exist yet; the release gate is closed.
