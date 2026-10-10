# M2-A3-01 Synthetic benchmark audit (AgentReport)

Agent 3 (Scientific Auditor), 2026-10-09 23:30 CEST. Reproduced from a clean worktree of 3b3fbe5:
16/16 M1 tests pass. Synthetic inputs only, no Barcelona runs. New tests: `tests/test_audit_m2.py`.

**Overall verdict: FAILED.** The benchmark is reproducible and conserves mass, but it does not show the solver is correct at its default settings.

## Independent checks
| Check | Result | Numbers |
|---|---|---|
| Re-derivation of the local-inertial step (loop code, 50 steps, seeded terrain) | PASSED | matches solver to rtol 1e-10; pre-clip min h > -1e-12 |
| Rain ledger vs analytic r·T·A | PASSED | rel 1e-12 |
| Green-Ampt vs Mein-Larson analytic | PASSED | F error 7.9e-4 / 7.1e-4 at dt 10 s; 6e-5 at 1 s (1st order) |
| Kinematic-wave plane equilibrium, α=0.35 | PASSED | h/h_KW = 1.030, 1.016, 1.009 at dx 20/10/5 m |
| Kinematic-wave plane, **default α=0.7, dt_max=10 s** | **FAILED** | h/h_KW = 0.40 (dx 10), oscillating 0.20–0.70 (dx 5); spurious Fr up to 15.6; MB still 1e-15 |
| Rain breakpoint not on an output time (storm ends 1805 s) | **FAILED** | rain volume +0.277 % |
| Sill test, tightened to 0.5 ≤ η < 0.502 | PASSED | η = 0.50065 m |
| Restart from a copied state at a non-aligned output interval | PASSED | f_cum, h agree within 1e-6 rel (dt sequence differs) |

## Defects (owner: Agent 2)
- **D1 (critical)** `src/bcnflood/solver/local_inertial.py:155-159` (`cfl_dt`) and `:163` (defaults α=0.7, dt_max=10). On a gentle 1 % plane the default step is unstable for shallow sheet flow: the result is wrong by up to 60 % and conserves mass exactly. α ≤ 0.35 (or dt_max ≤ 2 s) gives the correct answer. Fix: lower the default α, add a velocity/friction-aware limit, and add an instability detector (e.g. Fr or oscillation check).
- **D2** `local_inertial.py:172-173`: `run()` only clips dt at output times, not at `rain_fn` breakpoints, so rain volume is wrong by up to rate·dt_max. Fix: accept breakpoints and clip dt to them.
- D3 (minor) `local_inertial.py:129`: the clip creates mass that is not booked. It is measured as negligible (<1e-12), but it should be booked or asserted.
- D4 (minor) `local_inertial.py:36,63`: F is seeded at 1e-6 m. This gives a small low bias at fine dt (-1e-5 rel).
- D5 (minor) `local_inertial.py:107-108`: face Manning n is the arithmetic mean of n, not of n².

## Mass ledger / 1e-9 tolerance
The ledger is ΔS = R − I − D − O with denominator max(R, S0), `local_inertial.py:182-185`. Because the flux divergence telescopes by construction, MB < 1e-9 (observed 1e-16 to 5e-15) only proves the bookkeeping is right. **It cannot detect wrong physics.** D1 has a perfect mass balance. Keep it as a necessary check, never as a sufficient one.

## Classification of the M1 tests (`tests/test_solver.py`)
| Test | Class | Reason / fix requested |
|---|---|---|
| flat_uniform_rain_analytic (:41) | valid (trivial) | — |
| sloping_plane (:51) | **invalid** | it passes at dx=10, α=0.7, where the solution is wrong (D1). Compare against KW h instead |
| depression_ponds_to_sill (:63) | weak | ±0.02 tolerance allows a leak below the sill. Use one-sided [0.5, 0.502) (done in audit test) |
| infiltration_reduces_runoff (:84) | weak | 100 mm never spills the bowl (25 m³/m storage). Outflow is only rain falling downstream of the sill |
| impervious_increases_runoff (:93) | weak | same; `infiltration == 0` is tautological |
| drainage_reduces_accumulation (:101) | weak | qualitative only |
| obstacle_blocks_flow (:108) | valid | — |
| no_negative_depth_extreme (:129) | **tautological** for positivity: `np.maximum` at :129 forces h ≥ 0. Only the MB part has value. Physical Fr ≈ 8 is outside the scheme's regime |
| reproducible (:137) | weak | no RNG anywhere; determinism is trivial |
| rainfall_sensitivity (:144) | **invalid** | the bowl never spills at 10/30/60 mm. Outflow 11.5/34.6/69.1 m³ ≈ rain on the cells downstream of the sill (11.25/33.75/67.5). It does not test what its name says |
| two_day_midnight (:153) | weak | restart is bit-identical by construction (same dt sequence) and f_cum is not compared. Strengthened in the audit test |
| api tests | out of scope (A5) | — |

Seeds: the M1 tests use no randomness. The audit tests use `default_rng(12345)`.
