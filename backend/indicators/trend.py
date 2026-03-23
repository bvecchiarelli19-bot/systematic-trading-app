"""10-Month SMA Trend Filter.

Price above 210-day SMA = bullish trend, below = bearish.
"""
import numpy as np
from backend.config import SMA_PERIOD


def compute_sma_trend(closes: np.ndarray) -> str | None:
    """Return 'ABOVE' or 'BELOW' relative to 10-month SMA, or None."""
    if len(closes) < SMA_PERIOD:
        return None

    sma = np.mean(closes[-SMA_PERIOD:])
    current_price = closes[-1]
    return "ABOVE" if current_price > sma else "BELOW"


def score_trend(trend: str | None) -> int:
    """Score 0 for bullish trend, 3 for bearish."""
    if trend is None:
        return 1
    return 0 if trend == "ABOVE" else 3
