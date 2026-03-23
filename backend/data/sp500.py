"""Fetch current S&P 500 constituent list from Wikipedia."""
import io
import logging
import urllib.request

import pandas as pd

logger = logging.getLogger(__name__)

SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"


def get_sp500_tickers() -> list[dict]:
    """Return list of {'ticker': ..., 'name': ..., 'sector': ...} for S&P 500."""
    try:
        req = urllib.request.Request(SP500_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8")

        tables = pd.read_html(io.StringIO(html))
        df = tables[0]
        results = []
        for _, row in df.iterrows():
            ticker = str(row["Symbol"]).replace(".", "-")  # BRK.B -> BRK-B for yfinance
            results.append({
                "ticker": ticker,
                "name": row.get("Security", ""),
                "sector": row.get("GICS Sector", ""),
            })
        logger.info(f"Fetched {len(results)} S&P 500 tickers from Wikipedia")
        return results
    except Exception as e:
        logger.error(f"Failed to fetch S&P 500 list: {e}")
        return []
