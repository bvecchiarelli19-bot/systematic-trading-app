"""Market data fetcher using yfinance with retry logic and rate limiting."""
import logging
import time
from datetime import datetime

import pandas as pd
import yfinance as yf
from sqlalchemy import text

from backend.data.database import SessionLocal, PriceHistory, Stock

logger = logging.getLogger(__name__)

BATCH_SIZE = 50
MAX_RETRIES = 3
RETRY_DELAY = 2          # seconds, doubles each retry
BATCH_DELAY = 1.0        # seconds between batches to avoid rate limits


def update_stock_list(tickers: list[dict]):
    """Insert or update the stock master list."""
    session = SessionLocal()
    try:
        for t in tickers:
            existing = session.query(Stock).filter_by(ticker=t["ticker"]).first()
            if existing:
                existing.name = t["name"]
                existing.sector = t["sector"]
            else:
                session.add(Stock(ticker=t["ticker"], name=t["name"], sector=t["sector"]))
        session.commit()
        logger.info(f"Updated {len(tickers)} stocks in master list")
    finally:
        session.close()


def fetch_price_data(tickers: list[str], period: str = "2y") -> dict:
    """Download price history for all tickers. Returns stats dict."""
    session = SessionLocal()
    total_inserted = 0
    warnings = []

    try:
        # Find which tickers already have data
        existing_tickers = set()
        result = session.execute(
            text("SELECT DISTINCT ticker FROM price_history")
        ).fetchall()
        existing_tickers = {r[0] for r in result}

        full_tickers = [t for t in tickers if t not in existing_tickers]
        incremental_tickers = [t for t in tickers if t in existing_tickers]

        if full_tickers:
            ins, warns = _download_batch(session, full_tickers, period=period)
            total_inserted += ins
            warnings.extend(warns)

        if incremental_tickers:
            ins, warns = _download_batch(session, incremental_tickers, period="5d")
            total_inserted += ins
            warnings.extend(warns)

        # Update last_fetched timestamps for all tickers that have data
        now = datetime.utcnow()
        session.query(Stock).filter(Stock.ticker.in_(tickers)).update(
            {Stock.last_fetched: now}, synchronize_session=False
        )

        session.commit()
        logger.info(f"Inserted {total_inserted} price rows total")
    except Exception as e:
        session.rollback()
        logger.error(f"Error fetching price data: {e}")
        raise
    finally:
        session.close()

    return {"inserted": total_inserted, "warnings": warnings}


def _download_batch(session, tickers: list[str], period: str) -> tuple[int, list]:
    """Download a batch of tickers and store in DB. Returns (inserted, warnings)."""
    inserted = 0
    warnings = []
    num_batches = (len(tickers) + BATCH_SIZE - 1) // BATCH_SIZE

    for i in range(0, len(tickers), BATCH_SIZE):
        batch = tickers[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        logger.info(f"Downloading batch {batch_num}/{num_batches}: {len(batch)} tickers")

        df = _download_with_retry(batch, period)

        if df is None or df.empty:
            warnings.append(f"Batch {batch_num}: all {len(batch)} tickers returned no data")
            continue

        if len(batch) == 1:
            ticker = batch[0]
            batch_inserted = _store_single(session, ticker, df)
        else:
            batch_inserted = _store_multi(session, batch, df)

        if batch_inserted == 0 and period != "5d":
            warnings.append(f"Batch {batch_num}: 0 new rows inserted for {len(batch)} tickers")

        inserted += batch_inserted

        # Rate limit delay between batches
        if i + BATCH_SIZE < len(tickers):
            time.sleep(BATCH_DELAY)

    return inserted, warnings


def _download_with_retry(tickers: list[str], period: str) -> pd.DataFrame | None:
    """Download with exponential backoff retry."""
    delay = RETRY_DELAY
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            df = yf.download(tickers, period=period, threads=True, progress=False)
            if df is not None and not df.empty:
                # Check for all-NaN data (yfinance returns shape but no values)
                if df.dropna(how="all").empty:
                    logger.warning(f"Attempt {attempt}: got empty DataFrame for {len(tickers)} tickers")
                    if attempt < MAX_RETRIES:
                        time.sleep(delay)
                        delay *= 2
                        continue
                return df
            return df
        except Exception as e:
            logger.warning(f"Attempt {attempt}/{MAX_RETRIES} failed: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(delay)
                delay *= 2
            else:
                logger.error(f"All {MAX_RETRIES} attempts failed for batch of {len(tickers)}")
                return None
    return None


def _store_single(session, ticker: str, df: pd.DataFrame) -> int:
    """Store price data from a single-ticker download."""
    count = 0
    for idx, row in df.iterrows():
        dt = idx.date() if hasattr(idx, "date") else idx
        close_val = _extract_val(row, "Close", ticker)
        if close_val is None or pd.isna(close_val):
            continue

        existing = session.query(PriceHistory).filter_by(ticker=ticker, date=dt).first()
        if existing:
            continue

        session.add(PriceHistory(
            ticker=ticker,
            date=dt,
            open=_extract_val(row, "Open", ticker) or 0,
            high=_extract_val(row, "High", ticker) or 0,
            low=_extract_val(row, "Low", ticker) or 0,
            close=close_val,
            volume=_extract_val(row, "Volume", ticker) or 0,
        ))
        count += 1
    return count


def _store_multi(session, tickers: list[str], df: pd.DataFrame) -> int:
    """Store price data from a multi-ticker download."""
    count = 0

    for ticker in tickers:
        try:
            # yfinance 1.2: columns are MultiIndex (Price, Ticker)
            ticker_close = None
            if isinstance(df.columns, pd.MultiIndex):
                if ("Close", ticker) in df.columns:
                    ticker_data = {}
                    for price_type in ["Open", "High", "Low", "Close", "Volume"]:
                        col = (price_type, ticker)
                        if col in df.columns:
                            ticker_data[price_type] = df[col]
                    ticker_close = ticker_data.get("Close")
                else:
                    continue
            else:
                continue

            if ticker_close is None:
                continue

            for idx in df.index:
                dt = idx.date() if hasattr(idx, "date") else idx
                cv = ticker_close.get(idx)
                if cv is None or pd.isna(cv):
                    continue

                existing = session.query(PriceHistory).filter_by(ticker=ticker, date=dt).first()
                if existing:
                    continue

                session.add(PriceHistory(
                    ticker=ticker,
                    date=dt,
                    open=float(ticker_data.get("Open", pd.Series()).get(idx, 0) or 0),
                    high=float(ticker_data.get("High", pd.Series()).get(idx, 0) or 0),
                    low=float(ticker_data.get("Low", pd.Series()).get(idx, 0) or 0),
                    close=float(cv),
                    volume=float(ticker_data.get("Volume", pd.Series()).get(idx, 0) or 0),
                ))
                count += 1

        except Exception as e:
            logger.warning(f"Failed to process {ticker}: {e}")

    return count


def _extract_val(row, field: str, ticker: str):
    """Extract a value from a row, handling both flat and MultiIndex formats."""
    try:
        val = row.get((field, ticker))
        if val is not None and not pd.isna(val):
            return float(val)
    except (KeyError, TypeError):
        pass

    try:
        val = row.get(field)
        if val is not None and not pd.isna(val):
            return float(val)
    except (KeyError, TypeError):
        pass

    return None
