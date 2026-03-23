"""Market data fetcher using yfinance."""
import logging
from datetime import datetime

import pandas as pd
import yfinance as yf
from sqlalchemy import text

from backend.data.database import SessionLocal, PriceHistory, Stock

logger = logging.getLogger(__name__)

BATCH_SIZE = 50


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


def fetch_price_data(tickers: list[str], period: str = "2y") -> int:
    """Download price history for all tickers. Returns count of rows inserted."""
    session = SessionLocal()
    total_inserted = 0

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
            total_inserted += _download_batch(session, full_tickers, period=period)

        if incremental_tickers:
            total_inserted += _download_batch(session, incremental_tickers, period="5d")

        session.commit()
        logger.info(f"Inserted {total_inserted} price rows total")
    except Exception as e:
        session.rollback()
        logger.error(f"Error fetching price data: {e}")
        raise
    finally:
        session.close()

    return total_inserted


def _download_batch(session, tickers: list[str], period: str) -> int:
    """Download a batch of tickers and store in DB."""
    inserted = 0

    for i in range(0, len(tickers), BATCH_SIZE):
        batch = tickers[i:i + BATCH_SIZE]
        logger.info(f"Downloading batch {i // BATCH_SIZE + 1}/{(len(tickers) + BATCH_SIZE - 1) // BATCH_SIZE}: {len(batch)} tickers")

        try:
            df = yf.download(batch, period=period, threads=True, progress=False)
        except Exception as e:
            logger.error(f"yfinance download failed for batch: {e}")
            continue

        if df is None or df.empty:
            continue

        if len(batch) == 1:
            # Single ticker: columns are like 'Close', 'Open', etc. (flat)
            # But yfinance 1.2 may still use MultiIndex with single ticker
            ticker = batch[0]
            inserted += _store_single(session, ticker, df)
        else:
            # Multi-ticker: MultiIndex columns (Price, Ticker)
            inserted += _store_multi(session, batch, df)

    return inserted


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
            # Try to extract this ticker's data
            ticker_close = None
            if isinstance(df.columns, pd.MultiIndex):
                # Try (Price, Ticker) format
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
        # Try MultiIndex first (Price, Ticker)
        val = row.get((field, ticker))
        if val is not None and not pd.isna(val):
            return float(val)
    except (KeyError, TypeError):
        pass

    try:
        # Try flat column
        val = row.get(field)
        if val is not None and not pd.isna(val):
            return float(val)
    except (KeyError, TypeError):
        pass

    return None
