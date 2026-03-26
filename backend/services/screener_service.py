"""Screener service — orchestrates data loading, indicator computation, and filtering."""
import logging
from datetime import datetime

import numpy as np
from sqlalchemy import text, func

from backend.data.database import SessionLocal, Stock, PriceHistory, IndicatorSnapshot
from backend.indicators.volatility import compute_volatility_percentile, score_volatility
from backend.indicators.trend import compute_sma_trend, score_trend
from backend.indicators.hurst import compute_hurst, score_hurst
from backend.indicators.tail_risk import compute_tail_risk, score_tail_risk
from backend.indicators.regime import classify_regime, passes_quantitative_gates

logger = logging.getLogger(__name__)


def run_screener() -> dict:
    """Run the full screening pipeline. Compute indicators and store snapshots."""
    session = SessionLocal()
    try:
        stocks = session.query(Stock).all()
        now = datetime.utcnow()
        computed = 0
        candidates = 0

        # Clear old snapshots
        session.query(IndicatorSnapshot).delete()

        for stock in stocks:
            prices = (
                session.query(PriceHistory)
                .filter_by(ticker=stock.ticker)
                .order_by(PriceHistory.date.asc())
                .all()
            )

            if len(prices) < 50:
                continue

            closes = np.array([p.close for p in prices], dtype=float)

            # Compute indicators
            vol_pct = compute_volatility_percentile(closes)
            sma_trend = compute_sma_trend(closes)
            hurst_val = compute_hurst(closes)
            tail_val = compute_tail_risk(closes)

            # Score each
            vs = score_volatility(vol_pct)
            ts = score_trend(sma_trend)
            hs = score_hurst(hurst_val)
            trs = score_tail_risk(tail_val)

            # Classify regime
            regime, pos_pct, composite = classify_regime(vs, ts, hs, trs)

            snapshot = IndicatorSnapshot(
                ticker=stock.ticker,
                computed_at=now,
                price=float(closes[-1]),
                vol_percentile=vol_pct,
                sma_trend=sma_trend,
                hurst=hurst_val,
                tail_risk=tail_val,
                regime=regime,
                position_pct=pos_pct,
                vol_score=vs,
                trend_score=ts,
                hurst_score=hs,
                tail_score=trs,
                composite_score=composite,
            )
            session.add(snapshot)
            computed += 1

            if passes_quantitative_gates(regime, sma_trend):
                candidates += 1

        session.commit()
        logger.info(f"Screener complete: {computed} computed, {candidates} candidates")
        return {"computed": computed, "candidates": candidates, "timestamp": now.isoformat()}
    except Exception as e:
        session.rollback()
        logger.error(f"Screener failed: {e}")
        raise
    finally:
        session.close()


def get_screener_results(
    regime_filter: str | None = None,
    sector_filter: str | None = None,
    sort_by: str = "composite_score",
    direction: str = "asc",
    candidates_only: bool = True,
) -> dict:
    """Fetch the latest screener results from the DB."""
    session = SessionLocal()
    try:
        query = session.query(IndicatorSnapshot, Stock).join(
            Stock, IndicatorSnapshot.ticker == Stock.ticker
        )

        if candidates_only:
            query = query.filter(
                IndicatorSnapshot.regime.in_(["CALM", "CAUTIOUS"]),
                IndicatorSnapshot.sma_trend == "ABOVE",
            )

        if regime_filter:
            query = query.filter(IndicatorSnapshot.regime == regime_filter.upper())

        if sector_filter:
            query = query.filter(Stock.sector == sector_filter)

        # Sort
        sort_col = getattr(IndicatorSnapshot, sort_by, IndicatorSnapshot.composite_score)
        if direction == "desc":
            query = query.order_by(sort_col.desc())
        else:
            query = query.order_by(sort_col.asc())

        results = query.all()

        # Get total counts
        total_screened = session.query(IndicatorSnapshot).count()

        # Get the timestamp
        latest = session.query(IndicatorSnapshot.computed_at).first()
        updated_at = latest[0].isoformat() if latest else None

        # Get all sectors for filter dropdown
        sectors = [r[0] for r in session.query(Stock.sector).distinct().order_by(Stock.sector).all() if r[0]]

        items = []
        for snap, stock in results:
            items.append({
                "ticker": snap.ticker,
                "name": stock.name,
                "sector": stock.sector,
                "price": round(snap.price, 2) if snap.price else None,
                "regime": snap.regime,
                "position_pct": snap.position_pct,
                "composite_score": snap.composite_score,
                "indicators": {
                    "vol_percentile": snap.vol_percentile,
                    "sma_trend": snap.sma_trend,
                    "hurst": snap.hurst,
                    "tail_risk": snap.tail_risk,
                },
                "scores": {
                    "vol": snap.vol_score,
                    "trend": snap.trend_score,
                    "hurst": snap.hurst_score,
                    "tail": snap.tail_score,
                },
                "last_fetched": stock.last_fetched.isoformat() if stock.last_fetched else None,
            })

        return {
            "updated_at": updated_at,
            "total_screened": total_screened,
            "total_passing": len(items) if candidates_only else sum(
                1 for i in items if i["regime"] in ("CALM", "CAUTIOUS") and i["indicators"]["sma_trend"] == "ABOVE"
            ),
            "candidates": items,
            "sectors": sectors,
        }
    finally:
        session.close()


def get_stock_detail(ticker: str) -> dict | None:
    """Get detailed info for a single stock."""
    session = SessionLocal()
    try:
        snap = session.query(IndicatorSnapshot).filter_by(ticker=ticker.upper()).first()
        stock = session.query(Stock).filter_by(ticker=ticker.upper()).first()
        if not snap or not stock:
            return None

        # Get recent prices for sparkline
        prices = (
            session.query(PriceHistory)
            .filter_by(ticker=ticker.upper())
            .order_by(PriceHistory.date.desc())
            .limit(60)
            .all()
        )
        price_history = [{"date": p.date.isoformat(), "close": round(p.close, 2)} for p in reversed(prices)]

        return {
            "ticker": snap.ticker,
            "name": stock.name,
            "sector": stock.sector,
            "price": round(snap.price, 2) if snap.price else None,
            "regime": snap.regime,
            "position_pct": snap.position_pct,
            "composite_score": snap.composite_score,
            "indicators": {
                "vol_percentile": snap.vol_percentile,
                "sma_trend": snap.sma_trend,
                "hurst": snap.hurst,
                "tail_risk": snap.tail_risk,
            },
            "scores": {
                "vol": snap.vol_score,
                "trend": snap.trend_score,
                "hurst": snap.hurst_score,
                "tail": snap.tail_score,
            },
            "price_history": price_history,
            "last_fetched": stock.last_fetched.isoformat() if stock.last_fetched else None,
        }
    finally:
        session.close()


def get_sector_summary() -> list[dict]:
    """Get regime distribution by sector."""
    session = SessionLocal()
    try:
        results = (
            session.query(
                Stock.sector,
                IndicatorSnapshot.regime,
                func.count().label("count"),
            )
            .join(Stock, IndicatorSnapshot.ticker == Stock.ticker)
            .group_by(Stock.sector, IndicatorSnapshot.regime)
            .all()
        )

        # Build per-sector dict
        sectors = {}
        for sector, regime, count in results:
            if sector not in sectors:
                sectors[sector] = {"sector": sector, "CALM": 0, "CAUTIOUS": 0, "RISKY": 0, "CRISIS": 0, "total": 0}
            sectors[sector][regime] = count
            sectors[sector]["total"] += count

        return sorted(sectors.values(), key=lambda s: s["sector"])
    finally:
        session.close()
