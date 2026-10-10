"""Run the whole pipeline: dataset, training and evaluation, scenarios, tests.

Run from the repo root:  ml/.venv/Scripts/python ml/run_all.py
"""
import subprocess
import sys
from pathlib import Path

ML = Path(__file__).resolve().parent
STEPS = [
    ["build_dataset.py"],
    ["train.py"],
    ["predict_scenarios.py"],
    ["-m", "pytest", "tests", "-q"],
]

for step in STEPS:
    print("\n=== running", " ".join(step), flush=True)
    code = subprocess.call([sys.executable, *step], cwd=ML)
    if code != 0:
        raise SystemExit(f"step failed: {' '.join(step)} (exit {code})")
print("\nAll steps passed.")
