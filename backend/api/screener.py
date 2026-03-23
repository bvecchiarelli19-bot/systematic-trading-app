"""Screener API endpoints."""
import threading
from fastapi import APIRouter, Query, HTTPException

from backend.services.screener_service import get_screener_results, get_stock_detail
from backend.services.scheduler import refresh_data, get_scheduler_state

router = APIRouter(prefix="/api", tags=["screener"])


@router.get("/screener")
def screener(
    regime: str | None = Query(None, description="Filter by regime"),
    sector: str | None = Query(None, description="Filter by sector"),
    sort: str = Query("composite_score", description="Sort column"),
    direction: str = Query("asc", description="Sort direction"),
    candidates_only: bool = Query(True, description="Only show passing candidates"),
):
    """Get screened stock candidates."""
    return get_screener_results(
        regime_filter=regime,
        sector_filter=sector,
        sort_by=sort,
        direction=direction,
        candidates_only=candidates_only,
    )


@router.get("/screener/{ticker}")
def stock_detail(ticker: str):
    """Get detailed indicator data for a single stock."""
    result = get_stock_detail(ticker)
    if not result:
        raise HTTPException(status_code=404, detail=f"Stock {ticker} not found")
    return result


@router.get("/status")
def status():
    """Get data freshness and scheduler state."""
    return get_scheduler_state()


@router.post("/refresh")
def trigger_refresh():
    """Manually trigger a data refresh."""
    state = get_scheduler_state()
    if state["is_running"]:
        return {"message": "Refresh already in progress", "status": "running"}

    thread = threading.Thread(target=refresh_data, daemon=True)
    thread.start()
    return {"message": "Refresh started", "status": "started"}
