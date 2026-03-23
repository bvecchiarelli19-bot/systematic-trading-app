"""Composite regime classifier.

Aggregates the four indicator scores into a single regime classification
and maps it to a position sizing rule.
"""
from backend.config import REGIME_RULES


def classify_regime(vol_score: int, trend_score: int, hurst_score: int, tail_score: int) -> tuple[str, int, int]:
    """Classify into regime based on composite score.

    Returns (regime_label, position_pct, composite_score).
    """
    composite = vol_score + trend_score + hurst_score + tail_score

    for regime, rules in REGIME_RULES.items():
        if composite <= rules["max_score"]:
            return regime, rules["position_pct"], composite

    return "CRISIS", 0, composite


def passes_quantitative_gates(regime: str, sma_trend: str | None) -> bool:
    """Return True if the stock passes all gates to be a candidate.

    Gates:
    1. Regime must be CALM or CAUTIOUS
    2. Trend must be bullish (ABOVE SMA)
    """
    if regime not in ("CALM", "CAUTIOUS"):
        return False
    if sma_trend != "ABOVE":
        return False
    return True
