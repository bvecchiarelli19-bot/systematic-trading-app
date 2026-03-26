"""Background scheduler for data refresh and indicator recomputation."""
import logging
from apscheduler.schedulers.background import BackgroundScheduler

from backend.config import REFRESH_INTERVAL_MINUTES
from backend.data.sp500 import get_sp500_tickers
from backend.data.fetcher import update_stock_list, fetch_price_data
from backend.services.screener_service import run_screener

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler()

# Track state
_state = {
    "last_refresh": None,
    "last_error": None,
    "is_running": False,
    "initial_load_done": False,
    "warnings": [],
}


def get_scheduler_state() -> dict:
    return dict(_state)


def refresh_data():
    """Full pipeline: fetch tickers, download prices, run screener."""
    if _state["is_running"]:
        logger.info("Refresh already in progress, skipping")
        return

    _state["is_running"] = True
    _state["warnings"] = []
    try:
        logger.info("Starting data refresh...")

        # 1. Get S&P 500 ticker list
        tickers = get_sp500_tickers()
        if not tickers:
            raise ValueError("Failed to fetch S&P 500 list")
        update_stock_list(tickers)

        # 2. Download price data (now returns stats with warnings)
        ticker_symbols = [t["ticker"] for t in tickers]
        fetch_result = fetch_price_data(ticker_symbols)
        if isinstance(fetch_result, dict) and fetch_result.get("warnings"):
            _state["warnings"] = fetch_result["warnings"]

        # 3. Run screener
        result = run_screener()

        _state["last_refresh"] = result["timestamp"]
        _state["last_error"] = None
        _state["initial_load_done"] = True
        logger.info(f"Data refresh complete: {result}")
    except Exception as e:
        _state["last_error"] = str(e)
        logger.error(f"Data refresh failed: {e}")
    finally:
        _state["is_running"] = False


def start_scheduler():
    """Start the background scheduler."""
    scheduler.add_job(
        refresh_data,
        "interval",
        minutes=REFRESH_INTERVAL_MINUTES,
        id="data_refresh",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(f"Scheduler started — refreshing every {REFRESH_INTERVAL_MINUTES} minutes")
