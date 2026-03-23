"""Application configuration."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = DATA_DIR / "screener.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

# How often to refresh market data (minutes)
REFRESH_INTERVAL_MINUTES = int(os.getenv("REFRESH_INTERVAL", "60"))

# Indicator parameters
VOLATILITY_WINDOW = 21        # 1-month realized vol
VOLATILITY_LOOKBACK = 252     # 1-year historical distribution
SMA_PERIOD = 210              # ~10 months trading days
HURST_LOOKBACK = 252          # 1-year for Hurst calculation
HURST_MAX_LAG = 20
TAIL_RISK_WINDOW = 63         # 3-month rolling window
TAIL_RISK_PERCENTILE = 5      # 5th percentile (CVaR proxy)

# Regime thresholds
REGIME_RULES = {
    "CALM":     {"max_score": 2,  "position_pct": 100},
    "CAUTIOUS": {"max_score": 5,  "position_pct": 66},
    "RISKY":    {"max_score": 8,  "position_pct": 33},
    "CRISIS":   {"max_score": 12, "position_pct": 0},
}
