"""Tail Risk indicator.

Measures left-tail risk using the 5th percentile of trailing 63-day
daily returns (a CVaR / Expected Shortfall proxy).
"""
import numpy as np
from backend.config import TAIL_RISK_WINDOW, TAIL_RISK_PERCENTILE


def compute_tail_risk(closes: np.ndarray) -> float | None:
    """Return the 5th percentile of recent daily returns (negative = risk)."""
    if len(closes) < TAIL_RISK_WINDOW + 1:
        return None

    recent_closes = closes[-(TAIL_RISK_WINDOW + 1):]
    returns = np.diff(recent_closes) / recent_closes[:-1] * 100  # percent returns

    tail = float(np.percentile(returns, TAIL_RISK_PERCENTILE))
    return round(tail, 2)


def score_tail_risk(tail: float | None) -> int:
    """Score 0-3 based on tail risk severity."""
    if tail is None:
        return 1
    # tail is a negative percentage — more negative = worse
    if tail >= -1.5:
        return 0  # minimal tail risk
    elif tail >= -2.5:
        return 1  # moderate
    elif tail >= -4.0:
        return 2  # elevated
    else:
        return 3  # severe
