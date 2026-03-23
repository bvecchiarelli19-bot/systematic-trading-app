"""Hurst Exponent indicator.

Uses the rescaled range (R/S) method to estimate the Hurst exponent.
H < 0.45 = mean-reverting, H ~ 0.5 = random walk, H > 0.55 = trending.
"""
import numpy as np
from backend.config import HURST_LOOKBACK, HURST_MAX_LAG


def compute_hurst(closes: np.ndarray) -> float | None:
    """Compute Hurst exponent using the R/S method. Returns H or None."""
    prices = closes[-HURST_LOOKBACK:] if len(closes) >= HURST_LOOKBACK else closes
    if len(prices) < 50:
        return None

    log_returns = np.diff(np.log(prices))
    n = len(log_returns)

    lags = range(2, min(HURST_MAX_LAG + 1, n // 2))
    rs_values = []
    lag_values = []

    for lag in lags:
        rs_list = []
        for start in range(0, n - lag + 1, lag):
            chunk = log_returns[start:start + lag]
            if len(chunk) < lag:
                continue
            mean_chunk = np.mean(chunk)
            cumdev = np.cumsum(chunk - mean_chunk)
            r = np.max(cumdev) - np.min(cumdev)
            s = np.std(chunk, ddof=1)
            if s > 0:
                rs_list.append(r / s)

        if rs_list:
            rs_values.append(np.mean(rs_list))
            lag_values.append(lag)

    if len(lag_values) < 3:
        return None

    log_lags = np.log(lag_values)
    log_rs = np.log(rs_values)

    # Linear regression: log(R/S) = H * log(n) + c
    coeffs = np.polyfit(log_lags, log_rs, 1)
    hurst = float(coeffs[0])

    # Clamp to reasonable range
    hurst = max(0.0, min(1.0, hurst))
    return round(hurst, 3)


def score_hurst(hurst: float | None) -> int:
    """Score 0-3 based on Hurst exponent.

    Low H (mean-reverting) in a trending system = problematic.
    High H (trending) = favorable for momentum strategies.
    """
    if hurst is None:
        return 1
    if hurst >= 0.55:
        return 0  # strong trend — favorable
    elif hurst >= 0.45:
        return 1  # random walk — neutral
    elif hurst >= 0.35:
        return 2  # mild mean-reversion
    else:
        return 3  # strong mean-reversion — unfavorable for trend-following
