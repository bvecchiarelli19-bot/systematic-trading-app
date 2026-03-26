"""Database setup with SQLAlchemy — supports SQLite (local) and PostgreSQL (production)."""
from sqlalchemy import create_engine, Column, Integer, Float, String, Date, DateTime, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import declarative_base, sessionmaker
from backend.config import DATABASE_URL

_is_sqlite = DATABASE_URL.startswith("sqlite")
_connect_args = {"check_same_thread": False} if _is_sqlite else {}
engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args=_connect_args,
    pool_pre_ping=not _is_sqlite,
)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


class Stock(Base):
    __tablename__ = "stocks"
    id = Column(Integer, primary_key=True)
    ticker = Column(String, unique=True, nullable=False, index=True)
    name = Column(String)
    sector = Column(String)
    last_fetched = Column(DateTime)


class PriceHistory(Base):
    __tablename__ = "price_history"
    id = Column(Integer, primary_key=True)
    ticker = Column(String, nullable=False, index=True)
    date = Column(Date, nullable=False)
    open = Column(Float)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float)
    volume = Column(Float)
    __table_args__ = (UniqueConstraint("ticker", "date", name="uq_ticker_date"),)


class IndicatorSnapshot(Base):
    __tablename__ = "indicator_snapshots"
    id = Column(Integer, primary_key=True)
    ticker = Column(String, nullable=False, index=True)
    computed_at = Column(DateTime, nullable=False)
    price = Column(Float)
    vol_percentile = Column(Float)
    sma_trend = Column(String)       # "ABOVE" or "BELOW"
    hurst = Column(Float)
    tail_risk = Column(Float)
    regime = Column(String)          # CALM / CAUTIOUS / RISKY / CRISIS
    position_pct = Column(Integer)
    vol_score = Column(Integer)
    trend_score = Column(Integer)
    hurst_score = Column(Integer)
    tail_score = Column(Integer)
    composite_score = Column(Integer)


class JournalEntry(Base):
    """Trade journal — persistent trade log."""
    __tablename__ = "journal_entries"
    id = Column(Integer, primary_key=True)

    # ── Entry data (from Module 1 + 2) ──
    ticker = Column(String, nullable=False, index=True)
    name = Column(String)
    sector = Column(String)
    entry_price = Column(Float, nullable=False)
    entry_date = Column(String, nullable=False)          # ISO date string
    trade_type = Column(String, default="equity")         # "equity" or "prediction"
    position_dollars = Column(Float, default=0)
    regime_at_entry = Column(String)                      # CALM / CAUTIOUS / RISKY / CRISIS
    composite_score = Column(Integer)
    position_pct = Column(Integer)
    thesis = Column(Text)
    target_price = Column(Float)
    stop_price = Column(Float)
    asymmetry_ratio = Column(Float)
    bias_score = Column(Integer)
    regime_confirmed = Column(Boolean)

    # ── Indicator snapshot at entry ──
    vol_percentile = Column(Float)
    sma_trend = Column(String)
    hurst = Column(Float)
    tail_risk = Column(Float)

    # ── Outcome data (filled on close) ──
    status = Column(String, default="OPEN")              # OPEN / CLOSED
    exit_price = Column(Float)
    exit_date = Column(String)
    outcome = Column(String)                              # WIN / LOSS
    regime_correct = Column(Boolean)                      # Was the regime reading correct?
    thesis_correct = Column(Boolean)                      # Was the thesis correct?
    key_learning = Column(Text)
    pnl_dollars = Column(Float)
    pnl_pct = Column(Float)

    # ── Prediction market fields ──
    predicted_probability = Column(Float)                 # 0-1 predicted prob
    actual_outcome_binary = Column(Integer)               # 0 or 1

    # ── Timestamps ──
    created_at = Column(String)                           # ISO datetime
    closed_at = Column(String)                            # ISO datetime


def _run_migrations():
    """Add columns that may be missing from existing databases."""
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    # Add last_fetched to stocks if missing
    if "stocks" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("stocks")]
        if "last_fetched" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE stocks ADD COLUMN last_fetched DATETIME"))


def init_db():
    Base.metadata.create_all(bind=engine)
    _run_migrations()
