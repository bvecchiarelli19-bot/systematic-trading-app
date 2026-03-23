"""FastAPI application factory."""
import logging
import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.data.database import init_db
from backend.api.screener import router as screener_router
from backend.api.journal import router as journal_router
from backend.services.scheduler import start_scheduler, refresh_data, get_scheduler_state

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="Systematic Trading Screener", version="1.0.0")

# Mount API routes
app.include_router(screener_router)
app.include_router(journal_router)

# Serve frontend static files
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR / "static")), name="static")


@app.get("/")
async def serve_index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/validate")
async def serve_validate():
    return FileResponse(str(FRONTEND_DIR / "validate.html"))


@app.get("/journal")
async def serve_journal():
    return FileResponse(str(FRONTEND_DIR / "journal.html"))


@app.on_event("startup")
async def startup():
    init_db()
    start_scheduler()

    # Kick off initial data load in background if no data exists
    state = get_scheduler_state()
    if not state["initial_load_done"]:
        thread = threading.Thread(target=refresh_data, daemon=True)
        thread.start()
