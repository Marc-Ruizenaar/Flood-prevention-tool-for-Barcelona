"""Shared constants for the flood susceptibility prototype.

Everything that could be "tuned to look better" is fixed here, in one place, and is
documented in ml/README.md. Do not change values after seeing results.
"""
from __future__ import annotations

from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
REPO = ML_DIR.parent
OUT = ML_DIR / "out"
TILE_DIR = OUT / "tiles"
DATA_ML = REPO / "data" / "ml"

FLOOD_DIR = REPO / "data" / "flood" / "urgell-2026-10-02_03"
STREETS_DIR = FLOOD_DIR / "streets"
HOTSPOTS_DIR = FLOOD_DIR / "hotspots"
GEOJSON_DIR = REPO / "data" / "geojson"

STORM_DATES = ["2026-10-02", "2026-10-03"]

# ---- label -------------------------------------------------------------------
LABEL_DEPTH_M = 0.15
LABEL_DEFINITION = "simulated max depth >= 0.15 m (moderate or worse)"

# ---- storm features ----------------------------------------------------------
# Drainage is a uniform sink (mm/h) in the physics model. Only 20 mm/h was simulated.
TRAINED_DRAINAGE_MM_H = 20.0
# Effective drain-hours. daily.json has no hourly rain, so the storm length is not known.
# We take it from the solver ledger of the heavy day (3 Oct): drained volume / rain volume
# * 143.4 mm = 61.0 mm drained, and 61.0 mm / 20 mm/h = 3.05 h. Rounded to 3 h.
# It was fixed BEFORE any model was trained and is not tuned.
STORM_HOURS = 3.0

# ---- terrain -----------------------------------------------------------------
DEM_ZOOM = 15
DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
# Mosaic margins around the street-data bounding box, in degrees (upstream hills to the
# north-west and the sea to the south-east must be inside the mosaic).
MARGIN_W, MARGIN_N, MARGIN_E, MARGIN_S = 0.020, 0.020, 0.035, 0.030
DOWNSAMPLE = 2          # 3.6 m native pixel -> 7.2 m
SMOOTH_PX = 5           # box smoothing before slope and flow (about 36 m)
MIN_TAN_SLOPE = 0.005   # floor so TWI stays finite on flats
DEPRESSION_FLOOR_M = 0.01
SEA_ELEV_M = 0.25       # cells at or below this are sea

# ---- evaluation --------------------------------------------------------------
THRESHOLD = 0.5
BLOCK_M = 500.0
CV_FOLDS = 5
EDGE_DISTANCE_M = 400.0
EDGE_DEPTH_M = 1.0
RANDOM_SEED = 42
N_RANDOM_POINTS = 3000
RADII_M = [150, 300]
TOP_N = 10
TOP_SPREAD_M = 200.0

# ---- trust rules (constants, not tuned) --------------------------------------
HIGH_LOSO_AUC = 0.8
HIGH_LIFT_300 = 1.5
HIGH_MIN_REAL_POINTS = 20
HIGH_MIN_STORMS = 5
MED_SPATIAL_AUC = 0.75
MED_LOSO_AUC = 0.65
MED_MIN_STORMS = 3

# ---- scenarios ---------------------------------------------------------------
SCEN_RAIN_MM = [25, 50, 75, 100, 143]
SCEN_DRAINAGE_MM_H = [10, 20, 30]
CAVEAT = ("Prototype trained on 2 simulated storms. Shows susceptibility under a what-if "
          "scenario, not a prediction of real weather.")
FORBIDDEN = ["will rain", "mm expected", "€", "guaranteed flood", "forecast"]

STATIC_FEATURES = ["elevation_m", "slope_pct", "log_flow_acc", "twi", "depression_depth_m",
                   "dist_buried_stream_m", "dist_sea_m"]
# rain_mm and drainage_mm_h are NOT model inputs: across 2 storms rain is collinear with
# excess, and drainage never varies in the training data. excess_rain_mm carries both.
STORM_FEATURES = ["excess_rain_mm"]
FEATURES = STATIC_FEATURES + STORM_FEATURES

HGB_PARAMS = dict(max_iter=200, learning_rate=0.05, max_depth=4, min_samples_leaf=40,
                  l2_regularization=1.0, early_stopping=False, random_state=42)
