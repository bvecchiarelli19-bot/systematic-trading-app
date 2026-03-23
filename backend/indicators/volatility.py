"""Volatility Percentile indicator.

Computes 21-day realized volatility and ranks it against the trailing
252-day distribution of 21-day realized vol readings.
"""
import numpy as np
from backend.config import VOLATILITY_WINDOW, VOLATILITY_LOOKBACK


def compute_volatility_percentile(closes: np.ndarray) -> float | None:
    """Return volatility percentile (0-100) or None if insufficient data."""
    if len(closes) < VOLATILITY_LOOKBACK + VOLATILITY_WINDOW:
        return None

    log_returns = np.diff(np.log(closes))

    # Rolling 21-day realized vol (annualized)
    rolling_vols = []
    for i in range(VOLATILITY_WINDOW, len(log_returns) + 1):
        window = log_returns[i - VOLATILITY_WINDOW:i]
        rolling_vols.append(np.std(window) * np.sqrt(252))

    if len(rolling_vols) < 2:
        return None

    current_vol = rolling_vols[-1]
    lookback_vols = rolling_vols[-VOLATILITY_LOOKBACK:] if len(rolling_vols) >= VOLATILITY_LOOKBACK else rolling_vols

    percentile = (np.sum(np.array(lookback_vols) <= current_vol) / len(lookback_vols)) * 100
    return round(float(percentile), 1)


def score_volatility(percentile: float | None) -> int:
    """Score 0-3 based on volatility percentile."""
    if percentile is None:
        return 1  # conservative default
    if percentile <= 50:
        return 0  # low vol
    elif percentile <= 70:
        return 1  # moderate
    elif percentile <= 85:
        return 2  # elevated
    else:
        return 3  # extreme
