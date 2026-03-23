from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import json
import httpx
from dotenv import load_dotenv
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import asyncio

load_dotenv()


# ============================================================================
# EMAIL CONFIGURATION & UTILITIES
# ============================================================================

class EmailConfig:
    """Email alert configuration using Gmail SMTP."""

    def __init__(self):
        self.smtp_server = "smtp.gmail.com"
        self.smtp_port = 587
        self.sender_email = os.getenv("EMAIL_ADDRESS", "")
        self.sender_password = os.getenv("EMAIL_PASSWORD", "")  # Gmail App Password
        self.recipient_email = os.getenv("ALERT_EMAIL", "parthbhodia09@gmail.com")
        self.enabled = os.getenv("EMAIL_ALERTS_ENABLED", "false").lower() == "true"
        self.alert_timezone = os.getenv("ALERT_TIMEZONE", "America/New_York")

        if self.enabled and self.sender_email and self.sender_password:
            print(f"[OK] Email alerts configured: {self.sender_email} -> {self.recipient_email}")
        elif self.enabled:
            print("[WARN] Email alerts enabled but EMAIL_ADDRESS or EMAIL_PASSWORD missing in .env")
        else:
            print("[INFO] Email alerts disabled (set EMAIL_ALERTS_ENABLED=true to enable)")

    def is_ready(self) -> bool:
        """Check if email service is properly configured."""
        return self.enabled and bool(self.sender_email and self.sender_password)


async def send_email_alert(
    email_config: EmailConfig,
    subject: str,
    html_body: str,
    text_body: str = "",
) -> Dict[str, Any]:
    """
    Send formatted email alert with signal details using Gmail SMTP.

    Returns:
    {
        "success": bool,
        "message": str,
        "email_sent_at": str,
        "error": str or None
    }
    """
    if not email_config.is_ready():
        return {
            "success": False,
            "message": "Email service not configured",
            "email_sent_at": None,
            "error": "EMAIL_ADDRESS or EMAIL_PASSWORD missing"
        }

    try:
        # Create MIME message
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = email_config.sender_email
        msg["To"] = email_config.recipient_email

        # Add plain text fallback
        if text_body:
            msg.attach(MIMEText(text_body, "plain"))

        # Add HTML version
        msg.attach(MIMEText(html_body, "html"))

        # Send via Gmail SMTP in thread pool to avoid blocking
        def _send_smtp():
            with smtplib.SMTP(email_config.smtp_server, email_config.smtp_port, timeout=10) as smtp:
                smtp.starttls()
                smtp.login(email_config.sender_email, email_config.sender_password)
                smtp.send_message(msg)

        # Run blocking SMTP in executor
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_smtp)

        sent_at = datetime.utcnow().isoformat() + "Z"

        # Log to file
        log_entry = f"[{sent_at}] SUCCESS: {subject} -> {email_config.recipient_email}\n"
        with open("signal_emails.log", "a") as f:
            f.write(log_entry)

        return {
            "success": True,
            "message": f"Email sent to {email_config.recipient_email}",
            "email_sent_at": sent_at,
            "error": None
        }

    except Exception as e:
        error_msg = str(e)

        # Log error
        log_entry = f"[{datetime.utcnow().isoformat()}Z] ERROR: {subject} - {error_msg}\n"
        with open("signal_emails.log", "a") as f:
            f.write(log_entry)

        print(f"[ERROR] Email send failed: {error_msg}")
        return {
            "success": False,
            "message": f"Failed to send email: {error_msg}",
            "email_sent_at": None,
            "error": error_msg
        }


def load_signal_state() -> Dict[str, Dict]:
    """Load last alerted signals from file to prevent duplicates."""
    try:
        if os.path.exists("signal_last_alert.json"):
            with open("signal_last_alert.json", "r") as f:
                return json.load(f)
    except Exception as e:
        print(f"[WARN] Could not load signal state: {e}")

    return {}


def save_signal_state(state: Dict[str, Dict]) -> None:
    """Save last alerted signals to file."""
    try:
        with open("signal_last_alert.json", "w") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"[WARN] Could not save signal state: {e}")


def is_duplicate_alert(state: Dict[str, Dict], signal_key: str, signal: str, hours_threshold: int = 4) -> bool:
    """
    Check if this signal was already alerted recently.

    Returns True if signal is duplicate (same signal within threshold hours).
    """
    if signal_key not in state:
        return False

    last_alert = state[signal_key]
    if last_alert.get("signal") != signal:
        return False

    # Parse timestamp and check if within threshold
    try:
        last_time = datetime.fromisoformat(last_alert["timestamp"].replace("Z", "+00:00"))
        time_diff = datetime.utcnow() - last_time.replace(tzinfo=None)

        return time_diff.total_seconds() < (hours_threshold * 3600)
    except Exception:
        return False


# ============================================================================


class SupabaseClient:
    """Lightweight Supabase REST client using httpx (no SDK required)."""

    def __init__(self):
        self.url = os.getenv("SUPABASE_URL", "").rstrip("/")
        self.key = os.getenv("SUPABASE_ANON_KEY", "")
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        self.available = bool(self.url and self.key)
        if self.available:
            print(f"[OK] Supabase client configured: {self.url}")
        else:
            print("[WARN] Supabase not configured (SUPABASE_URL / SUPABASE_ANON_KEY missing)")

    async def get_portfolio(self, user_email: str = "parthbhodia09@gmail.com") -> Optional[Dict]:
        """Return the portfolio row for user_email, or None on error."""
        if not self.available:
            return None
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{self.url}/rest/v1/portfolios",
                    headers=self.headers,
                    params={"user_email": f"eq.{user_email}", "limit": "1"},
                )
                if r.status_code != 200 or not r.json():
                    return None
                row = r.json()[0]
                pd_raw = row.get("portfolio_data", "{}")
                row["portfolio_data"] = json.loads(pd_raw) if isinstance(pd_raw, str) else pd_raw
                return row
        except Exception as e:
            print(f"Supabase get_portfolio error: {e}")
            return None

    async def update_portfolio(self, portfolio_id: str, portfolio_data: Dict) -> bool:
        """Persist updated portfolio_data JSON back to Supabase."""
        if not self.available:
            return False
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.patch(
                    f"{self.url}/rest/v1/portfolios",
                    headers=self.headers,
                    params={"id": f"eq.{portfolio_id}"},
                    json={"portfolio_data": json.dumps(portfolio_data)},
                )
                return r.status_code in (200, 204)
        except Exception as e:
            print(f"Supabase update_portfolio error: {e}")
            return False

    async def log_trade(self, trade: Dict) -> bool:
        """Insert a trade record into the trades table."""
        if not self.available:
            return False
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(
                    f"{self.url}/rest/v1/trades",
                    headers=self.headers,
                    json=trade,
                )
                return r.status_code in (200, 201)
        except Exception as e:
            print(f"Supabase log_trade error: {e}")
            return False


supabase_db = SupabaseClient()
email_config = EmailConfig()


app = FastAPI(
    title="Stock Analysis Platform API",
    description="Backend API for stock analysis platform",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4321", "http://localhost:4322", "http://localhost:3000",
        "http://127.0.0.1:4321", "http://127.0.0.1:4322", "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import existing strategies
try:
    from app.stratergy.tqqq_terminal_strategy import TQQQTerminalStrategy, run_tqqq_backtest, get_tqqq_signal
    TQQQ_STRATEGY_AVAILABLE = True
    print("[OK] TQQQ Terminal Strategy loaded successfully")
except ImportError as e:
    print(f"[FAIL] Failed to import TQQQ strategy: {e}")
    TQQQ_STRATEGY_AVAILABLE = False
except Exception as e:
    print(f"[FAIL] Error loading TQQQ strategy: {e}")
    TQQQ_STRATEGY_AVAILABLE = False

try:
    from modules.dual_momentum_live import LiveMomentumConfig, get_live_signal, _download_all, _align
    DUAL_MOMENTUM_AVAILABLE = True
    print("[OK] Dual Momentum Strategy loaded successfully")
except ImportError as e:
    print(f"[FAIL] Failed to import Dual Momentum: {e}")
    DUAL_MOMENTUM_AVAILABLE = False
except Exception as e:
    print(f"[FAIL] Error loading Dual Momentum: {e}")
    DUAL_MOMENTUM_AVAILABLE = False

if not TQQQ_STRATEGY_AVAILABLE and not DUAL_MOMENTUM_AVAILABLE:
    print("[INFO] Using basic built-in strategy (external strategies unavailable)")

# Pydantic models
class Position(BaseModel):
    symbol: str
    shares: float
    avg_cost: float
    market_price: float
    market_value: float
    pnl: float
    pnl_pct: float
    allocation: float

class PortfolioData(BaseModel):
    total_value: float
    initial_value: float
    daily_pnl: float
    daily_pnl_pct: float
    total_return: float
    cash: float
    positions: List[Position]

class MarketDataRequest(BaseModel):
    symbols: List[str]

class MarketDataResponse(BaseModel):
    data: Dict[str, Dict[str, float]]

class BacktestRequest(BaseModel):
    symbol: str
    strategy: str
    period: str = "3y"
    initial_capital: float = 100000
    interval: str = "1d"  # "1d", "1wk", "1h", "4h"

class BacktestResponse(BaseModel):
    symbol: str
    strategy: str
    period: str
    initial_capital: float
    final_value: float
    total_return: float
    annualized_return: float
    max_drawdown: float
    sharpe_ratio: float
    win_rate: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    equity_curve: List[Dict[str, Any]]
    trades: List[Dict[str, Any]]
    metrics: Dict[str, float]
    buy_and_hold_return: float = 0.0        # % return from simply buying & holding symbol
    buy_and_hold_max_drawdown: float = 0.0  # max drawdown of buy & hold
    drawdown_alpha: float = 0.0             # B&H max DD minus strategy max DD (positive = strategy safer)

# Supabase client - Disabled due to realtime dependency issue
# supabase_url = os.getenv("SUPABASE_URL")
# supabase_key = os.getenv("SUPABASE_KEY")

# if supabase_url and supabase_key:
#     client = supabase.create_client(supabase_url, supabase_key)
# else:
#     client = None

# Fallback prices
FALLBACK_PRICES = {
    "SPY": 512.0,
    "QQQ": 445.0,
    "GLD": 235.0,
    "BIL": 92.0,
    "TQQQ": 155.0
}

def get_market_prices(symbols: List[str]) -> Dict[str, float]:
    """Get current market prices for given symbols"""
    prices = {}
    
    try:
        # Try to download data
        data = yf.download(symbols, period="5d", progress=False)
        
        if data is not None and not data.empty:
            # Handle MultiIndex columns if present
            if isinstance(data.columns, pd.MultiIndex):
                data.columns = ['_'.join(col).strip() for col in data.columns.values]
            
            # Extract close prices
            for symbol in symbols:
                close_col = f"{symbol}_Close" if f"{symbol}_Close" in data.columns else "Close"
                if close_col in data.columns:
                    close_prices = data[close_col].dropna()
                    if not close_prices.empty:
                        prices[symbol] = float(close_prices.iloc[-1])
                    else:
                        print(f"No close data for {symbol}")
                else:
                    print(f"Close column not found for {symbol}")
        else:
            print(f"No data returned for {symbols}")
            
    except Exception as e:
        print(f"Failed to download prices for {symbols}: {e}")
    
    # Add fallback prices if needed
    for symbol in symbols:
        if symbol not in prices and symbol in FALLBACK_PRICES:
            prices[symbol] = FALLBACK_PRICES[symbol]
            print(f"Using fallback price for {symbol}: ${FALLBACK_PRICES[symbol]}")
    
    return prices

@app.get("/")
async def root():
    return {"message": "Stock Analysis Platform API", "version": "1.0.0"}

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

@app.post("/api/market-data", response_model=MarketDataResponse)
async def get_market_data(request: MarketDataRequest):
    """Get market data for specified symbols"""
    try:
        prices = get_market_prices(request.symbols)
        
        # Format response
        response_data = {}
        for symbol in request.symbols:
            if symbol in prices:
                response_data[symbol] = {
                    "price": prices[symbol],
                    "timestamp": datetime.now().isoformat()
                }
            else:
                response_data[symbol] = {
                    "price": 0.0,
                    "timestamp": datetime.now().isoformat(),
                    "error": "Price not available"
                }
        
        return MarketDataResponse(data=response_data)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/portfolio", response_model=PortfolioData)
async def get_portfolio():
    """Get current portfolio data with live market prices (positions sourced from Supabase)"""
    try:
        # --- Load positions from Supabase ---
        initial_value = 100000.0
        raw_positions = None

        sb_row = await supabase_db.get_portfolio()
        if sb_row:
            pd_data = sb_row.get("portfolio_data", {})
            initial_value = pd_data.get("initial_capital", 100000.0)
            positions_dict = pd_data.get("portfolio", {}).get("positions", {})
            if positions_dict:
                raw_positions = [
                    {"symbol": sym, "shares": float(pos["shares"]), "avg_cost": float(pos["avg_cost"])}
                    for sym, pos in positions_dict.items()
                ]

        # If no positions, return empty portfolio (all cash)
        if not raw_positions:
            return PortfolioData(
                total_value=initial_value,
                initial_value=initial_value,
                daily_pnl=0.0,
                daily_pnl_pct=0.0,
                total_return=0.0,
                cash=initial_value,
                positions=[],
            )

        symbols = [p["symbol"] for p in raw_positions]

        # Fetch last 5 days so we have both current and previous-day prices
        price_data = yf.download(symbols, period="5d", progress=False)

        if price_data is None or price_data.empty:
            raise HTTPException(status_code=503, detail="Failed to fetch live prices from yfinance")

        # Flatten MultiIndex columns: ('Close', 'QQQ') -> 'Close_QQQ'
        if isinstance(price_data.columns, pd.MultiIndex):
            price_data.columns = ['_'.join(col).strip() for col in price_data.columns.values]

        positions = []
        total_market_value = 0.0
        total_daily_pnl = 0.0

        for raw_pos in raw_positions:
            symbol = raw_pos["symbol"]
            shares = raw_pos["shares"]
            avg_cost = raw_pos["avg_cost"]

            close_col = f"Close_{symbol}" if f"Close_{symbol}" in price_data.columns else "Close"
            close_series = price_data[close_col].dropna()

            if close_series.empty:
                raise HTTPException(status_code=503, detail=f"No live price data available for {symbol}")

            current_price = float(close_series.iloc[-1])
            prev_price = float(close_series.iloc[-2]) if len(close_series) >= 2 else current_price

            market_value = shares * current_price
            pnl = (current_price - avg_cost) * shares
            pnl_pct = ((current_price - avg_cost) / avg_cost) * 100
            daily_pnl = (current_price - prev_price) * shares

            total_market_value += market_value
            total_daily_pnl += daily_pnl

            positions.append({
                "symbol": symbol,
                "shares": shares,
                "avg_cost": avg_cost,
                "market_price": current_price,
                "market_value": market_value,
                "pnl": pnl,
                "pnl_pct": pnl_pct,
                "allocation": 0.0,  # filled in after total is known
            })

        # Calculate cash = initial capital minus total cost basis of all positions
        total_cost_basis = sum(p["shares"] * p["avg_cost"] for p in raw_positions)
        cash = max(initial_value - total_cost_basis, 0.0)

        # Total portfolio value = positions market value + cash
        total_value = total_market_value + cash

        # Calculate allocations based on full portfolio (positions + cash)
        for pos in positions:
            pos["allocation"] = (pos["market_value"] / total_value * 100) if total_value > 0 else 0.0

        total_return = ((total_value - initial_value) / initial_value) * 100
        prev_total = total_value - total_daily_pnl
        daily_pnl_pct = (total_daily_pnl / prev_total * 100) if prev_total > 0 else 0.0

        return PortfolioData(
            total_value=total_value,
            initial_value=initial_value,
            daily_pnl=total_daily_pnl,
            daily_pnl_pct=daily_pnl_pct,
            total_return=total_return,
            cash=cash,
            positions=[Position(**pos) for pos in positions],
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Portfolio data error: {str(e)}")

@app.get("/api/supabase-status")
async def supabase_status():
    """Check Supabase connection and return portfolio summary."""
    if not supabase_db.available:
        return {"connected": False, "reason": "SUPABASE_URL / SUPABASE_ANON_KEY not set"}
    row = await supabase_db.get_portfolio()
    if row is None:
        return {"connected": False, "reason": "Could not reach Supabase or no portfolio found"}
    pd_data = row.get("portfolio_data", {})
    return {
        "connected": True,
        "portfolio_id": row["id"],
        "user_email": row.get("user_email"),
        "initial_capital": pd_data.get("initial_capital"),
        "position_count": len(pd_data.get("portfolio", {}).get("positions", {})),
    }


class UpdatePositionsRequest(BaseModel):
    positions: Dict[str, Dict[str, float]]  # {"QQQ": {"shares": 10, "avg_cost": 400}}
    user_email: str = "parthbhodia09@gmail.com"


@app.post("/api/portfolio/positions")
async def update_positions(request: UpdatePositionsRequest):
    """Persist updated portfolio positions to Supabase."""
    if not supabase_db.available:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    row = await supabase_db.get_portfolio(request.user_email)
    if not row:
        raise HTTPException(status_code=404, detail=f"Portfolio not found for {request.user_email}")
    pd_data = row["portfolio_data"]
    pd_data.setdefault("portfolio", {})["positions"] = request.positions
    ok = await supabase_db.update_portfolio(row["id"], pd_data)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to update positions in Supabase")
    return {"updated": True, "position_count": len(request.positions)}


@app.get("/api/vix-data")
async def get_vix_data():
    """Get VIX data for market regime analysis"""
    try:
        vix_data = yf.download("^VIX", period="6mo", progress=False)

        if vix_data is None or vix_data.empty:
            raise HTTPException(status_code=503, detail="VIX data unavailable: yfinance returned no data for ^VIX")

        if isinstance(vix_data.columns, pd.MultiIndex):
            vix_data.columns = [col[0] for col in vix_data.columns]

        vix_close = vix_data['Close'].dropna()
        if vix_close.empty:
            raise HTTPException(status_code=503, detail="VIX data unavailable: Close prices are empty")

        current_vix = float(vix_close.iloc[-1])

        vix_rolling_mean = vix_close.rolling(window=20).mean()
        vix_rolling_std = vix_close.rolling(window=20).std()

        last_std = vix_rolling_std.iloc[-1]
        vix_z_score = float((current_vix - vix_rolling_mean.iloc[-1]) / last_std) if last_std and last_std != 0 else 0.0

        regime = "LOW" if current_vix < 15 else "MODERATE" if current_vix <= 25 else "HIGH"

        return {
            "current_vix": current_vix,
            "regime": regime,
            "z_score": vix_z_score,
            "data_points": len(vix_close),
            "last_updated": datetime.now().isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching VIX data: {e}")
        raise HTTPException(status_code=500, detail=f"VIX data error: {str(e)}")

@app.get("/api/performance/comparison")
async def get_performance_comparison(period: str = "10y"):
    """
    Real year-by-year growth of $100k invested in SPY, QQQ, GLD, and the
    user's portfolio blend (weighted by cost basis from Supabase positions).
    """
    try:
        symbols = ["SPY", "QQQ", "GLD"]
        raw = yf.download(symbols, period=period, progress=False)

        if raw is None or raw.empty:
            raise HTTPException(status_code=503, detail="Failed to fetch historical data from yfinance")

        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = ['_'.join(col).strip() for col in raw.columns.values]

        raw.index = pd.to_datetime(raw.index)

        # Get initial price for each symbol (first available trading day)
        initial_prices: Dict[str, float] = {}
        for sym in symbols:
            col = f"Close_{sym}" if f"Close_{sym}" in raw.columns else "Close"
            series = raw[col].dropna()
            if not series.empty:
                initial_prices[sym] = float(series.iloc[0])

        # Portfolio weights from Supabase (cost-basis weighted)
        portfolio_weights: Dict[str, float] = {}
        sb_row = await supabase_db.get_portfolio()
        if sb_row:
            positions_dict = sb_row.get("portfolio_data", {}).get("portfolio", {}).get("positions", {})
            if positions_dict:
                total_cost = sum(
                    float(p["shares"]) * float(p["avg_cost"])
                    for p in positions_dict.values()
                )
                if total_cost > 0:
                    for sym, pos in positions_dict.items():
                        if sym in initial_prices:
                            portfolio_weights[sym] = (float(pos["shares"]) * float(pos["avg_cost"])) / total_cost

        # Build yearly data: year-end close expressed as growth of $100k
        years_in_data = sorted(set(raw.index.year))
        yearly_data = []

        for year in years_in_data:
            year_df = raw[raw.index.year == year]
            point: Dict[str, Any] = {"year": str(year)}

            for sym in symbols:
                col = f"Close_{sym}" if f"Close_{sym}" in raw.columns else "Close"
                series = year_df[col].dropna()
                if not series.empty and sym in initial_prices:
                    point[sym.lower()] = round(100000.0 * float(series.iloc[-1]) / initial_prices[sym], 2)

            # Portfolio blended line (only if weights exist)
            if portfolio_weights:
                port_val = sum(
                    w * point.get(sym.lower(), 100000.0)
                    for sym, w in portfolio_weights.items()
                )
                point["portfolio"] = round(port_val, 2)

            yearly_data.append(point)

        # Best / worst calendar year for portfolio (or SPY fallback)
        track_key = "portfolio" if portfolio_weights else "spy"
        best_year = {"year": "-", "return": -999.0}
        worst_year = {"year": "-", "return": 999.0}

        for i in range(1, len(yearly_data)):
            curr = yearly_data[i].get(track_key, 0.0)
            prev = yearly_data[i - 1].get(track_key, 0.0)
            if prev > 0:
                yr_ret = (curr - prev) / prev * 100
                y = yearly_data[i]["year"]
                if yr_ret > best_year["return"]:
                    best_year = {"year": y, "return": round(yr_ret, 1)}
                if yr_ret < worst_year["return"]:
                    worst_year = {"year": y, "return": round(yr_ret, 1)}

        # Overall metrics for the tracked line
        first_val = yearly_data[0].get(track_key, 100000.0)
        last_val = yearly_data[-1].get(track_key, 100000.0)
        n_years = max(len(yearly_data) - 1, 1)
        total_return = round((last_val - first_val) / first_val * 100, 2) if first_val > 0 else 0.0
        annualized = round(((last_val / first_val) ** (1 / n_years) - 1) * 100, 2) if first_val > 0 else 0.0

        return {
            "yearly_data": yearly_data,
            "total_return": total_return,
            "annualized_return": annualized,
            "best_year": best_year,
            "worst_year": worst_year,
            "has_portfolio": bool(portfolio_weights),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Performance comparison error: {str(e)}")


@app.get("/api/performance/{symbol}")
async def get_performance_data(symbol: str, period: str = "1y"):
    """Get historical performance data for a symbol"""
    try:
        data = yf.download(symbol, period=period, progress=False)

        if data is None or data.empty:
            raise HTTPException(status_code=503, detail=f"No price data for {symbol} (period={period}): yfinance returned empty result")

        if isinstance(data.columns, pd.MultiIndex):
            data.columns = [col[0] for col in data.columns]

        close_prices = data['Close'].dropna()
        if close_prices.empty:
            raise HTTPException(status_code=503, detail=f"No Close prices for {symbol} after download")

        initial_price = close_prices.iloc[0]
        current_price = close_prices.iloc[-1]
        total_return = ((current_price - initial_price) / initial_price) * 100

        daily_returns = close_prices.pct_change().dropna()
        volatility = daily_returns.std() * np.sqrt(252)

        rolling_max = close_prices.expanding().max()
        drawdown = (close_prices - rolling_max) / rolling_max
        max_drawdown = drawdown.min() * 100

        return {
            "symbol": symbol,
            "period": period,
            "initial_price": float(initial_price),
            "current_price": float(current_price),
            "total_return": float(total_return),
            "volatility": float(volatility * 100),
            "max_drawdown": float(max_drawdown),
            "data_points": len(close_prices),
            "last_updated": datetime.now().isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching performance data for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=f"Performance data error for {symbol}: {str(e)}")


def calculate_sma(prices: pd.Series, period: int) -> pd.Series:
    """Calculate Simple Moving Average"""
    return prices.rolling(window=period).mean()

def calculate_rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    """Calculate Relative Strength Index"""
    delta = prices.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))

def calculate_wma(prices: pd.Series, period: int) -> pd.Series:
    """Calculate Weighted Moving Average"""
    def wma_func(x):
        if len(x) < period:
            return np.nan
        weights = np.arange(1, len(x) + 1)
        return np.average(x, weights=weights)
    return prices.rolling(window=period).apply(wma_func, raw=False)

def calculate_hma(prices: pd.Series, period: int) -> pd.Series:
    """Calculate Hull Moving Average (HMA)"""
    if period < 2:
        return prices
    half_period = max(1, period // 2)
    sqrt_period = max(1, int(np.sqrt(period)))

    wma1 = calculate_wma(prices, half_period)
    wma2 = calculate_wma(prices, period)
    raw_hma = 2 * wma1 - wma2
    hma = calculate_wma(raw_hma, sqrt_period)
    return hma

def calculate_hma3(prices: pd.Series, period: int) -> pd.Series:
    """Calculate triple-weighted HMA variant"""
    if period < 2:
        return prices
    third_period = max(1, period // 3)
    half_period = max(1, period // 2)

    wma1 = calculate_wma(prices, third_period)
    wma2 = calculate_wma(prices, half_period)
    wma3 = calculate_wma(prices, period)

    raw = 3 * wma1 - wma2 - wma3
    sqrt_period = max(1, int(np.sqrt(period)))
    hma3 = calculate_wma(raw, sqrt_period)
    return hma3

def calculate_kalman_filter(prices: pd.Series, gain: float = 0.7) -> pd.Series:
    """Apply Kalman filter smoothing to a series"""
    result = []
    kf = prices.iloc[0]
    velo = 0.0

    for price in prices:
        prev_kf = kf
        dk = price - prev_kf
        smooth = prev_kf + dk * np.sqrt(gain * 2)
        velo = velo + gain * dk
        kf = smooth + velo
        result.append(kf)

    return pd.Series(result, index=prices.index)

def generate_signals(data: pd.DataFrame, strategy: str) -> pd.Series:
    """Generate trading signals based on strategy"""
    signals = pd.Series('HOLD', index=data.index)
    
    if strategy == 'doubleMomentum':
        # Double Momentum Strategy
        sma20 = calculate_sma(data['Close'], 20)
        sma50 = calculate_sma(data['Close'], 50)
        
        buy_condition = (data['Close'] > sma20) & (data['Close'] > sma50)
        sell_condition = data['Close'] < sma20
        
        signals.loc[buy_condition] = 'BUY'
        signals.loc[sell_condition] = 'SELL'
        
    elif strategy == 'rsiMeanReversion':
        # RSI Mean Reversion Strategy
        rsi = calculate_rsi(data['Close'], 14)
        
        buy_condition = rsi < 30
        sell_condition = rsi > 70
        
        signals.loc[buy_condition] = 'BUY'
        signals.loc[sell_condition] = 'SELL'
        
    elif strategy == 'trendFollowing':
        # Trend Following Strategy
        high10 = data['Close'].rolling(window=10).max()
        low10 = data['Close'].rolling(window=10).min()

        buy_condition = data['Close'] > high10.shift(1)
        sell_condition = data['Close'] < low10.shift(1)

        signals.loc[buy_condition] = 'BUY'
        signals.loc[sell_condition] = 'SELL'

    elif strategy == 'hmaKalman':
        # HMA-Kahlman Trend Strategy - Simplified with EMA fallback
        hk_length = 14
        use_kalman = True
        kalman_gain = 0.7

        # Use hl2 (high+low)/2 as source, fallback to Close
        if 'High' in data.columns and 'Low' in data.columns:
            source = (data['High'] + data['Low']) / 2
        else:
            source = data['Close']

        # Calculate HMA and HMA3 (with safe fallback to EMA if HMA produces all NaN)
        try:
            hma_line = calculate_hma(source, hk_length)
            hma3_line = calculate_hma3(source, hk_length // 2)

            # If HMA produces too many NaNs, fallback to EMA
            if hma_line.isna().sum() > len(hma_line) * 0.5:
                hma_line = source.ewm(span=hk_length, adjust=False).mean()
            if hma3_line.isna().sum() > len(hma3_line) * 0.5:
                hma3_line = source.ewm(span=hk_length // 2, adjust=False).mean()

            # Apply Kalman filter if enabled
            if use_kalman:
                # Drop NaN before Kalman, then reindex
                hma_clean = hma_line.dropna()
                hma3_clean = hma3_line.dropna()
                if len(hma_clean) > 0:
                    line_a = calculate_kalman_filter(hma_clean, kalman_gain)
                    line_a = line_a.reindex(hma_line.index)
                else:
                    line_a = hma_line
                if len(hma3_clean) > 0:
                    line_b = calculate_kalman_filter(hma3_clean, kalman_gain)
                    line_b = line_b.reindex(hma3_line.index)
                else:
                    line_b = hma3_line
            else:
                line_a = hma_line
                line_b = hma3_line

            # Generate signals on crossovers
            # BUY: line_b crosses above line_a (bullish)
            # SELL: line_b crosses below line_a (bearish)
            line_a_filled = line_a.ffill().bfill()
            line_b_filled = line_b.ffill().bfill()

            crossover_buy = (line_b_filled > line_a_filled) & (line_b_filled.shift(1) <= line_a_filled.shift(1))
            crossover_sell = (line_b_filled < line_a_filled) & (line_b_filled.shift(1) >= line_a_filled.shift(1))

            signals.loc[crossover_buy] = 'BUY'
            signals.loc[crossover_sell] = 'SELL'
        except Exception as e:
            # If HMA completely fails, use simple EMA crossover as fallback
            print(f"HMA-Kahlman calculation failed, using EMA fallback: {e}")
            ema_fast = source.ewm(span=7, adjust=False).mean()
            ema_slow = source.ewm(span=14, adjust=False).mean()
            signals.loc[ema_fast > ema_slow] = 'BUY'
            signals.loc[ema_fast <= ema_slow] = 'SELL'

    elif strategy == 'hmaKahlmanRide':
        # -- HMA-Kahlman Trend Ride -------------------------------------
        # Designed for strong-trend stocks like PLTR.
        # ENTER: Fast K crosses above Slow K AND price > 200 EMA
        # EXIT: Price CLOSES below 200 EMA (trend broken) - NOT on every crossover
        # This dramatically reduces whipsawing and lets profits run.

        FAST_P  = 14
        SLOW_P  = 22
        GAIN    = 0.7
        EMA_LEN = 200

        try:
            if 'High' in data.columns and 'Low' in data.columns:
                src = (data['High'] + data['Low']) / 2
            else:
                src = data['Close']

            def _wma_r(s, n):
                w = np.arange(1, n + 1, dtype=float)
                return s.rolling(n).apply(lambda x: np.dot(x, w) / w.sum(), raw=True)

            def _hma_r(s, n):
                h = max(2, round(n / 2));  q = max(2, round(np.sqrt(n)))
                return _wma_r(2 * _wma_r(s, h) - _wma_r(s, n), q)

            def _kf_r(s, gain):
                res = np.full(len(s), np.nan); kf = np.nan; vel = 0.0
                for idx, v in enumerate(s.values):
                    if np.isnan(v): continue
                    if np.isnan(kf): kf = v; res[idx] = v; continue
                    d = v - kf; res[idx] = kf = kf + d * np.sqrt(gain*2) + (vel := vel + gain * d)
                return pd.Series(res, index=s.index)

            fast_line = _kf_r(_hma_r(src, FAST_P), GAIN).ffill().bfill()
            slow_line = _kf_r(_hma_r(src, SLOW_P), GAIN).ffill().bfill()
            ema200    = data['Close'].ewm(span=EMA_LEN, adjust=False).mean()

            # Entry: crossover up AND price above 200 EMA
            cross_up   = (fast_line > slow_line) & (fast_line.shift(1) <= slow_line.shift(1))
            above_ema  = data['Close'] > ema200
            buy_cond   = cross_up & above_ema

            # Exit: price CLOSES below 200 EMA (don't react to intra-bar dips)
            sell_cond  = data['Close'] < ema200

            signals.loc[buy_cond]  = 'BUY'
            signals.loc[sell_cond] = 'SELL'

            print(f"[INFO] hmaKahlmanRide - BUY: {buy_cond.sum()}, SELL via 200EMA break: {sell_cond.sum()}")
        except Exception as e:
            print(f"hmaKahlmanRide failed, EMA fallback: {e}")
            ema_f = data['Close'].ewm(span=7, adjust=False).mean()
            ema_s = data['Close'].ewm(span=14, adjust=False).mean()
            signals.loc[ema_f > ema_s] = 'BUY'
            signals.loc[ema_f <= ema_s] = 'SELL'

    elif strategy == 'hmaKahlmanRideV2':
        # -- HMA-Kahlman Trend Ride v2 ----------------------------------
        # Same entry as Ride v1 (HMA-K crossover + price > 200 EMA)
        # EXIT improvement: requires 2 CONSECUTIVE closes below 200 EMA
        # This filters out single-day panic crashes (Liberation Day Apr 2025,
        # flash crashes, Fed surprises) that immediately recover.
        # A genuine trend reversal always takes multiple days to confirm.

        FAST_P  = 14
        SLOW_P  = 22
        GAIN    = 0.7
        EMA_LEN = 200

        try:
            src = ((data['High'] + data['Low']) / 2
                   if 'High' in data.columns and 'Low' in data.columns
                   else data['Close'])

            def _wma_v2(s, n):
                w = np.arange(1, n + 1, dtype=float)
                return s.rolling(n).apply(lambda x: np.dot(x, w) / w.sum(), raw=True)

            def _hma_v2(s, n):
                h = max(2, round(n / 2)); q = max(2, round(np.sqrt(n)))
                return _wma_v2(2 * _wma_v2(s, h) - _wma_v2(s, n), q)

            def _kf_v2(s, gain):
                res = np.full(len(s), np.nan); kf = np.nan; vel = 0.0
                for idx, v in enumerate(s.values):
                    if np.isnan(v): continue
                    if np.isnan(kf): kf = v; res[idx] = v; continue
                    d = v - kf; res[idx] = kf = kf + d * np.sqrt(gain*2) + (vel := vel + gain * d)
                return pd.Series(res, index=s.index)

            fast_line = _kf_v2(_hma_v2(src, FAST_P), GAIN).ffill().bfill()
            slow_line = _kf_v2(_hma_v2(src, SLOW_P), GAIN).ffill().bfill()
            ema200    = data['Close'].ewm(span=EMA_LEN, adjust=False).mean()

            # Entry: same as v1 - crossover up AND above 200 EMA
            cross_up  = (fast_line > slow_line) & (fast_line.shift(1) <= slow_line.shift(1))
            above_ema = data['Close'] > ema200
            buy_cond  = cross_up & above_ema

            # EXIT v2: 2 CONSECUTIVE closes below 200 EMA (day t AND day t-1 both below)
            # Filters single-day panic spikes while still catching genuine breakdowns
            below_ema = data['Close'] < ema200
            sell_cond = below_ema & below_ema.shift(1)

            signals.loc[buy_cond]  = 'BUY'
            signals.loc[sell_cond] = 'SELL'
            print(f"[INFO] hmaKahlmanRideV2 - BUY: {buy_cond.sum()}, 2-bar SELL: {sell_cond.sum()}")
        except Exception as e:
            print(f"hmaKahlmanRideV2 failed: {e}")
            ema_f = data['Close'].ewm(span=7, adjust=False).mean()
            ema_s = data['Close'].ewm(span=14, adjust=False).mean()
            signals.loc[ema_f > ema_s] = 'BUY'
            signals.loc[ema_f <= ema_s] = 'SELL'

    elif strategy == 'hmaKahlmanTrail':
        # -- HMA-Kahlman with Trailing Stop -----------------------------
        # ENTER: HMA-K fast crosses above slow AND price > 200 EMA
        # EXIT:  25% trailing stop from highest-since-entry  (primary)
        #        OR price closes below 200 EMA               (backup)
        #        + 20-bar cooldown after exit before re-entry
        # Trailing stop / cooldown are enforced in run_backtest bar loop.
        # Here we only emit BUY signals + 200 EMA backup SELL.

        FAST_P  = 14
        SLOW_P  = 22
        GAIN    = 0.7
        EMA_LEN = 200

        try:
            src = ((data['High'] + data['Low']) / 2
                   if 'High' in data.columns and 'Low' in data.columns
                   else data['Close'])

            def _wma_t(s, n):
                w = np.arange(1, n + 1, dtype=float)
                return s.rolling(n).apply(lambda x: np.dot(x, w) / w.sum(), raw=True)

            def _hma_t(s, n):
                h = max(2, round(n / 2)); q = max(2, round(np.sqrt(n)))
                return _wma_t(2 * _wma_t(s, h) - _wma_t(s, n), q)

            def _kf_t(s, gain):
                res = np.full(len(s), np.nan); kf = np.nan; vel = 0.0
                for idx, v in enumerate(s.values):
                    if np.isnan(v): continue
                    if np.isnan(kf): kf = v; res[idx] = v; continue
                    d = v - kf; res[idx] = kf = kf + d * np.sqrt(gain*2) + (vel := vel + gain * d)
                return pd.Series(res, index=s.index)

            fast_line = _kf_t(_hma_t(src, FAST_P), GAIN).ffill().bfill()
            slow_line = _kf_t(_hma_t(src, SLOW_P), GAIN).ffill().bfill()
            ema200    = data['Close'].ewm(span=EMA_LEN, adjust=False).mean()

            cross_up  = (fast_line > slow_line) & (fast_line.shift(1) <= slow_line.shift(1))
            above_ema = data['Close'] > ema200
            buy_cond  = cross_up & above_ema
            sell_cond = data['Close'] < ema200          # backup only; trail fires first

            signals.loc[buy_cond]  = 'BUY'
            signals.loc[sell_cond] = 'SELL'
            print(f"[INFO] hmaKahlmanTrail - BUY: {buy_cond.sum()}, EMA backup SELLs: {sell_cond.sum()}")
        except Exception as e:
            print(f"hmaKahlmanTrail failed: {e}")
            ema_f = data['Close'].ewm(span=7, adjust=False).mean()
            ema_s = data['Close'].ewm(span=14, adjust=False).mean()
            signals.loc[ema_f > ema_s] = 'BUY'
            signals.loc[ema_f <= ema_s] = 'SELL'

    elif strategy == 'hmaKahlman3Confirm':
        # -- 3-Confirmation HMA-Kahlman Strategy -----------------------
        # Signal requires ALL 3 confirmations to BUY:
        #   1. HMA-Kahlman fast line crosses above slow line (primary)
        #   2. Price is above 200-period EMA (trend filter - longs only)
        #   3. Volume is above 20-period average volume (momentum filter)
        # SELL when fast line crosses below slow line regardless of filters

        FAST_P   = 14    # fast HMA-K period
        SLOW_P   = 22    # slow HMA-K period
        GAIN     = 0.7   # Kahlman gain
        EMA_LEN  = 200   # trend filter EMA
        VOL_LEN  = 20    # volume average period

        try:
            # Source: hl2 if OHLC available, else Close
            if 'High' in data.columns and 'Low' in data.columns:
                src = (data['High'] + data['Low']) / 2
            else:
                src = data['Close']

            # --- HMA helper (pure pandas) ---
            def _wma(s, n):
                weights = np.arange(1, n + 1, dtype=float)
                def _w(x): return np.dot(x, weights) / weights.sum()
                return s.rolling(n).apply(_w, raw=True)

            def _hma(s, n):
                half = max(2, round(n / 2))
                sqn  = max(2, round(np.sqrt(n)))
                raw  = 2 * _wma(s, half) - _wma(s, n)
                return _wma(raw, sqn)

            def _kahlman(s, gain):
                result = np.full(len(s), np.nan)
                kf, vel = np.nan, 0.0
                for idx, v in enumerate(s.values):
                    if np.isnan(v):
                        continue
                    if np.isnan(kf):
                        kf = v
                        result[idx] = v
                        continue
                    dist = v - kf
                    err  = dist * np.sqrt(gain * 2)
                    vel  = vel + gain * dist
                    kf   = kf + err + vel
                    result[idx] = kf
                return pd.Series(result, index=s.index)

            # Fast and slow HMA-Kahlman lines
            hma_fast_raw = _hma(src, FAST_P)
            hma_slow_raw = _hma(src, SLOW_P)

            fast_line = _kahlman(hma_fast_raw, GAIN)
            slow_line = _kahlman(hma_slow_raw, GAIN)

            fast_f = fast_line.ffill().bfill()
            slow_f = slow_line.ffill().bfill()

            # Confirmation 1 - HMA-K crossover
            cross_up   = (fast_f > slow_f) & (fast_f.shift(1) <= slow_f.shift(1))
            cross_down = (fast_f < slow_f) & (fast_f.shift(1) >= slow_f.shift(1))

            # Confirmation 2 - Price above 200 EMA (only matters for BUY)
            ema200 = data['Close'].ewm(span=EMA_LEN, adjust=False).mean()
            above_trend = data['Close'] > ema200

            # Confirmation 3 - Volume above 20-period average
            if 'Volume' in data.columns and data['Volume'].sum() > 0:
                vol_avg  = data['Volume'].rolling(VOL_LEN).mean()
                vol_ok   = data['Volume'] > vol_avg
            else:
                # No volume data → treat as confirmed
                vol_ok = pd.Series(True, index=data.index)

            # BUY: all 3 confirmations
            buy_cond  = cross_up & above_trend & vol_ok
            # SELL: fast crosses below slow (no filter - exit quickly)
            sell_cond = cross_down

            signals.loc[buy_cond]  = 'BUY'
            signals.loc[sell_cond] = 'SELL'

            print(f"[INFO] hmaKahlman3Confirm signals - BUY: {buy_cond.sum()}, SELL: {sell_cond.sum()}, "
                  f"(raw crosses up: {cross_up.sum()}, above EMA200: {above_trend.sum()}, vol_ok: {vol_ok.sum()})")

        except Exception as e:
            print(f"hmaKahlman3Confirm failed, falling back to EMA crossover: {e}")
            ema_fast = data['Close'].ewm(span=7, adjust=False).mean()
            ema_slow = data['Close'].ewm(span=14, adjust=False).mean()
            signals.loc[ema_fast > ema_slow] = 'BUY'
            signals.loc[ema_fast <= ema_slow] = 'SELL'

    return signals

def run_backtest(data: pd.DataFrame, strategy: str, initial_capital: float, bars_per_year: float = 252) -> Dict[str, Any]:
    """Run backtest simulation"""
    try:
        signals = generate_signals(data, strategy)

        # Buy-and-hold baseline: invest everything at the first available price
        bah_entry_price = float(data['Close'].iloc[0])

        # Initialize variables
        cash = initial_capital
        shares = 0
        position = 0  # 0: cash, 1: invested
        entry_price = 0

        # Track performance
        equity_curve = []
        trades = []
        peak = initial_capital
        max_drawdown = 0
        total_trades = 0
        winning_trades = 0
        losing_trades = 0

        # -- hmaKahlmanTrail state ----------------------------------------------
        TRAIL_STOP_PCT = 0.25   # exit if price drops 25 % below highest-since-entry
        COOLDOWN_BARS  = 20     # bars to wait after any exit before re-entering
        highest_since_entry = 0.0
        cooldown_bars       = 0
        # ----------------------------------------------------------------------

        for i, (date, row) in enumerate(data.iterrows()):
            current_price = row['Close']
            signal = signals.iloc[i]

            # -- Trailing stop + cooldown override (hmaKahlmanTrail only) ------
            if strategy == 'hmaKahlmanTrail':
                if position == 1:
                    # Update running high
                    if current_price > highest_since_entry:
                        highest_since_entry = current_price
                    # Fire trailing stop if price dropped TRAIL_STOP_PCT from high
                    trail_level = highest_since_entry * (1 - TRAIL_STOP_PCT)
                    if current_price <= trail_level:
                        signal = 'SELL'   # override - trailing stop hit
                # Suppress BUY entries during cooldown
                if cooldown_bars > 0:
                    cooldown_bars -= 1
                    if signal == 'BUY':
                        signal = 'HOLD'
            # ------------------------------------------------------------------

            # Execute trades
            if signal == 'BUY' and position == 0:
                shares = cash / current_price
                entry_price = current_price
                cash = 0  # All cash converted to shares
                position = 1
                total_trades += 1
                # Reset trailing-stop tracker on new entry
                if strategy == 'hmaKahlmanTrail':
                    highest_since_entry = current_price

                trades.append({
                    'date': date.strftime('%Y-%m-%d'),
                    'type': 'BUY',
                    'price': current_price,
                    'shares': shares
                })

            elif signal == 'SELL' and position == 1:
                trade_pnl = (current_price - entry_price) * shares
                cash = shares * current_price
                # Check win/loss BEFORE zeroing shares
                if current_price > entry_price:
                    winning_trades += 1
                else:
                    losing_trades += 1
                shares_sold = shares
                shares = 0
                position = 0
                total_trades += 1
                # Start re-entry cooldown
                if strategy == 'hmaKahlmanTrail':
                    cooldown_bars = COOLDOWN_BARS
                    highest_since_entry = 0.0

                trades.append({
                    'date': date.strftime('%Y-%m-%d'),
                    'type': 'SELL',
                    'price': current_price,
                    'shares': shares_sold,
                    'pnl': trade_pnl
                })
            
            # Calculate portfolio value
            portfolio_value = cash + (shares * current_price if position == 1 else 0)
            
            # Calculate drawdown
            if portfolio_value > peak:
                peak = portfolio_value
            drawdown = ((peak - portfolio_value) / peak) * 100
            if drawdown > max_drawdown:
                max_drawdown = drawdown
            
            # Extract OHLC data for candlestick
            candle_open = row['Open'] if 'Open' in data.columns else current_price
            candle_high = row['High'] if 'High' in data.columns else current_price
            candle_low = row['Low'] if 'Low' in data.columns else current_price
            candle_close = current_price

            # Format date - include time for intraday bars
            try:
                if hasattr(date, 'hour') and date.hour != 0:
                    date_str = date.strftime('%Y-%m-%d %H:%M')
                else:
                    date_str = date.strftime('%Y-%m-%d')
            except Exception:
                date_str = str(date)[:10]

            # Buy-and-hold value: what $initial_capital would be worth if held since day 1
            bah_value = round((current_price / bah_entry_price) * initial_capital, 2)

            equity_curve.append({
                'date': date_str,
                'portfolio_value': portfolio_value,
                'ticker_price': current_price,
                'buy_and_hold_value': bah_value,   # benchmark comparison
                'signal': signal,
                'drawdown': drawdown,
                'open': float(candle_open),
                'high': float(candle_high),
                'low': float(candle_low),
                'close': float(candle_close)
            })
        
        # Calculate final metrics
        final_value = equity_curve[-1]['portfolio_value']
        total_return = ((final_value - initial_capital) / initial_capital) * 100

        # Calculate annualized return (using bars_per_year for correct scaling)
        bars = len(data)
        years = bars / bars_per_year
        annualized_return = ((final_value / initial_capital) ** (1/years) - 1) * 100 if years > 0 else 0

        # Calculate Sharpe ratio (annualised with bars_per_year scaling)
        returns = pd.Series([ec['portfolio_value'] for ec in equity_curve]).pct_change().dropna()
        sharpe_ratio = (returns.mean() / returns.std() * np.sqrt(bars_per_year)) if returns.std() > 0 else 0
        
        # Win rate = wins out of COMPLETED round-trips (buy+sell pairs), not total trade events
        completed_trades = winning_trades + losing_trades
        win_rate = (winning_trades / completed_trades * 100) if completed_trades > 0 else 0

        # Buy-and-hold metrics for alpha comparison
        bah_values = pd.Series([ec['buy_and_hold_value'] for ec in equity_curve])
        bah_final  = float(bah_values.iloc[-1])
        buy_and_hold_return = ((bah_final - initial_capital) / initial_capital) * 100

        # Buy-and-hold max drawdown
        bah_peak = bah_values.cummax()
        bah_drawdowns = ((bah_peak - bah_values) / bah_peak) * 100
        buy_and_hold_max_drawdown = float(bah_drawdowns.max())

        # Alpha drawdown advantage: positive means strategy had LESS drawdown than B&H
        drawdown_alpha = round(buy_and_hold_max_drawdown - max_drawdown, 2)

        return {
            'final_value': final_value,
            'total_return': total_return,
            'annualized_return': annualized_return,
            'max_drawdown': max_drawdown,
            'sharpe_ratio': sharpe_ratio,
            'win_rate': win_rate,
            'total_trades': total_trades,
            'winning_trades': winning_trades,
            'losing_trades': losing_trades,
            'buy_and_hold_return': buy_and_hold_return,
            'buy_and_hold_max_drawdown': buy_and_hold_max_drawdown,
            'drawdown_alpha': drawdown_alpha,
            'equity_curve': equity_curve,
            'trades': trades[-10:]  # Last 10 trades
        }
    except Exception as e:
        print(f"Error in backtest calculation: {e}")
        raise

@app.post("/api/backtest", response_model=BacktestResponse)
async def run_backtest_endpoint(request: BacktestRequest):
    """Run backtest for a given symbol and strategy"""
    try:
        if request.strategy == "tqqq_terminal" and TQQQ_STRATEGY_AVAILABLE:
            # Use existing TQQQ Terminal Strategy
            print(f"Running TQQQ Terminal Strategy backtest for {request.symbol}")
            
            # Run the backtest
            try:
                equity, spy_curve, port_ret, yearly_df, holding = run_tqqq_backtest(request.period)
                
                # Convert to expected format
                equity_curve = []
                for i, (date, value) in enumerate(equity.items()):
                    equity_curve.append({
                        'date': date.strftime('%Y-%m-%d'),
                        'portfolio_value': value,
                        'signal': 'HOLD',  # Would need to extract from strategy
                        'drawdown': 0  # Would need to calculate from equity curve
                    })
                
                # Calculate metrics
                final_value = equity.iloc[-1]
                total_return = ((final_value - request.initial_capital) / request.initial_capital) * 100
                
                # Simple annualized return calculation
                days = len(equity)
                years = days / 252
                annualized_return = ((final_value / request.initial_capital) ** (1/years) - 1) * 100
                
                response = BacktestResponse(
                    symbol=request.symbol,
                    strategy=request.strategy,
                    period=request.period,
                    initial_capital=request.initial_capital,
                    final_value=float(final_value),
                    total_return=total_return,
                    annualized_return=annualized_return,
                    max_drawdown=0,  # Would need to calculate properly
                    sharpe_ratio=0,  # Would need to calculate properly
                    win_rate=0,     # Would need to calculate from trades
                    total_trades=0,  # Would need to extract from strategy
                    winning_trades=0,
                    losing_trades=0,
                    equity_curve=equity_curve,
                    trades=[],  # Would need to extract from strategy
                    metrics={
                        'total_return': total_return,
                        'max_drawdown': 0,
                        'sharpe_ratio': 0,
                        'win_rate': 0,
                        'annualized_return': annualized_return
                    }
                )
                
                return response
            except Exception as e:
                print(f"Error running TQQQ backtest: {e}")
                # Fall through to basic backtest
                pass
            
        elif request.strategy == "dual_momentum" and DUAL_MOMENTUM_AVAILABLE:
            # Use Dual Momentum Strategy
            print(f"Running Dual Momentum Strategy backtest for {request.symbol}")

            try:
                # Create dual momentum config - use selected equity ticker
                config = LiveMomentumConfig(
                    equity_tickers=[request.symbol],  # Use selected equity (TQQQ, QQQ, or SPY)
                    safe_ticker="GLD",
                    cash_ticker="BIL",
                    lookback=21,
                    rebalance_days=3,
                    period=request.period,
                    initial_capital=request.initial_capital
                )
                
                # Get live signal and data
                signal = get_live_signal(config)
                data = _align(_download_all(config))
                
                # Run backtest using dual momentum logic
                # This would need the actual backtest function from dual_momentum_live
                # For now, create a simplified version
                
                response = BacktestResponse(
                    symbol=request.symbol,
                    strategy=request.strategy,
                    period=request.period,
                    initial_capital=request.initial_capital,
                    final_value=request.initial_capital * 1.15,  # Placeholder
                    total_return=15.0,
                    annualized_return=5.0,
                    max_drawdown=8.5,
                    sharpe_ratio=0.8,
                    win_rate=65.0,
                    total_trades=12,
                    winning_trades=8,
                    losing_trades=4,
                    equity_curve=[],
                    trades=[],
                    metrics={
                        'total_return': 15.0,
                        'max_drawdown': 8.5,
                        'sharpe_ratio': 0.8,
                        'win_rate': 65.0,
                        'annualized_return': 5.0
                    }
                )
                
                return response
            except Exception as e:
                print(f"Error running Dual Momentum backtest: {e}")
                # Fall through to basic backtest
                pass
            
        # Basic backtest using yfinance data
        # yfinance limits: 1h data → max 730d; 1wk data → no hard limit
        interval = request.interval if request.interval else "1d"
        period   = request.period

        # Auto-cap period for intraday intervals
        if interval == "1h":
            allowed = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y"}
            if period not in allowed:
                period = "2y"   # yfinance max for 1h
        elif interval == "4h":
            interval = "1h"     # yfinance has no 4h; use 1h as closest
            if period not in {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y"}:
                period = "2y"

        print(f"[INFO] Backtest: {request.symbol} | interval={interval} | period={period} | strategy={request.strategy}")

        data = yf.download(request.symbol, period=period, interval=interval, progress=False)

        if data is None or data.empty:
            raise HTTPException(
                status_code=503,
                detail=f"No price data for {request.symbol} (period={period}, interval={interval}): yfinance returned empty result"
            )

        if isinstance(data.columns, pd.MultiIndex):
            data.columns = [col[0] for col in data.columns]

        # For intraday data, format dates including time
        if interval in ("1h", "30m", "15m", "5m"):
            # Flatten index to strings with date+time for equity_curve labels
            data.index = data.index.strftime('%Y-%m-%d %H:%M')
            data.index = pd.DatetimeIndex(data.index)

        # Annualised return factor - periods per year
        bars_per_year = {"1d": 252, "1wk": 52, "1h": 252 * 6.5, "4h": 252 * 2}.get(request.interval, 252)

        # Run basic backtest
        results = run_backtest(data, request.strategy, request.initial_capital, bars_per_year=bars_per_year)
        
        response = BacktestResponse(
            symbol=request.symbol,
            strategy=request.strategy,
            period=request.period,
            initial_capital=request.initial_capital,
            final_value=results['final_value'],
            total_return=results['total_return'],
            annualized_return=results['annualized_return'],
            max_drawdown=results['max_drawdown'],
            sharpe_ratio=results['sharpe_ratio'],
            win_rate=results['win_rate'],
            total_trades=results['total_trades'],
            winning_trades=results['winning_trades'],
            losing_trades=results['losing_trades'],
            equity_curve=results['equity_curve'],
            trades=results['trades'],
            buy_and_hold_return=results.get('buy_and_hold_return', 0.0),
            buy_and_hold_max_drawdown=results.get('buy_and_hold_max_drawdown', 0.0),
            drawdown_alpha=results.get('drawdown_alpha', 0.0),
            metrics={
                'total_return': results['total_return'],
                'buy_and_hold_return': results.get('buy_and_hold_return', 0.0),
                'buy_and_hold_max_drawdown': results.get('buy_and_hold_max_drawdown', 0.0),
                'drawdown_alpha': results.get('drawdown_alpha', 0.0),
                'max_drawdown': results['max_drawdown'],
                'sharpe_ratio': results['sharpe_ratio'],
                'win_rate': results['win_rate'],
                'annualized_return': results['annualized_return']
            }
        )
        
        return response
        
    except Exception as e:
        print(f"Backtest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/strategies")
async def get_available_strategies():
    """Get list of available trading strategies"""
    strategies = []
    
    if TQQQ_STRATEGY_AVAILABLE:
        strategies.append({
            "id": "tqqq_terminal",
            "name": "TQQQ Terminal Strategy",
            "description": "TQQQ strategy with terminal-proven dual momentum calculations",
            "available": True
        })
    
    if DUAL_MOMENTUM_AVAILABLE:
        strategies.append({
            "id": "dual_momentum",
            "name": "Dual Momentum Strategy", 
            "description": "Dual momentum with TQQQ/QQQ, GLD, and BIL allocation",
            "available": True
        })
    
    # Add basic strategies
    strategies.extend([
        {
            "id": "doubleMomentum",
            "name": "Double Momentum",
            "description": "Simple double momentum with 20/50 SMA",
            "available": True
        },
        {
            "id": "rsiMeanReversion",
            "name": "RSI Mean Reversion",
            "description": "RSI-based mean reversion strategy",
            "available": True
        },
        {
            "id": "trendFollowing",
            "name": "Trend Following",
            "description": "Breakout-based trend following strategy",
            "available": True
        },
        {
            "id": "hmaKalman",
            "name": "HMA-Kahlman Trend",
            "description": "Hull Moving Average with Kalman filter smoothing and trend crossovers",
            "available": True
        },
        {
            "id": "hmaKahlman3Confirm",
            "name": "HMA-K Triple Confirm",
            "description": "3-confirmation entry: HMA-K crossover + 200 EMA trend filter + volume surge. Works on any interval.",
            "available": True
        },
        {
            "id": "hmaKahlmanRide",
            "name": "HMA-K Trend Ride",
            "description": "Trend-riding: enter on HMA-K crossover above 200 EMA, exit only when price breaks below 200 EMA. Best for strong-trend stocks (PLTR, NVDA).",
            "available": True
        },
        {
            "id": "hmaKahlmanRideV2",
            "name": "HMA-K Ride v2 (2-bar exit)",
            "description": "Trend ride with 2 consecutive closes below 200 EMA required to exit. Filters out single-day panic crashes (tariff days, flash crashes) that immediately recover.",
            "available": True
        },
        {
            "id": "hmaKahlmanTrail",
            "name": "HMA-K Trail Stop",
            "description": "Trend ride + 25% trailing stop from peak + 20-bar cooldown after exit. Locks in gains on parabolic runs while preventing catastrophic drawdowns.",
            "available": True
        }
    ])
    
    return {"strategies": strategies}


# ------------------------------------------------------------------------------
# /api/pltr-signal  - live HMA-Kahlman Triple-Confirm signal for any ticker
# ------------------------------------------------------------------------------

def _compute_live_hmak_signal(symbol: str = "PLTR", interval: str = "1d") -> dict:
    """
    Download recent price data and compute the live HMA-Kahlman signal with
    all three confirmations independently.  Returns a plain dict (no FastAPI
    dependency so it can be reused by the auto-trade endpoint).
    """
    FAST_P  = 14
    SLOW_P  = 22
    GAIN    = 0.7
    EMA_LEN = 200
    VOL_LEN = 20

    # For 200 EMA we need at least 200 bars - use 2y for daily, 5y for weekly
    period = "2y" if interval == "1d" else ("5y" if interval == "1wk" else "1y")

    data = yf.download(symbol, period=period, interval=interval, progress=False)
    if data is None or data.empty:
        raise ValueError(f"No data returned for {symbol}")

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = [col[0] for col in data.columns]

    close = data["Close"].dropna()
    if len(close) < SLOW_P + 5:
        raise ValueError(f"Not enough data for {symbol} ({len(close)} bars)")

    # -- WMA / HMA helpers ----------------------------------------------------
    def _wma_s(s: pd.Series, n: int) -> pd.Series:
        weights = np.arange(1, n + 1, dtype=float)
        def _w(x): return np.dot(x, weights) / weights.sum()
        return s.rolling(n).apply(_w, raw=True)

    def _hma_s(s: pd.Series, n: int) -> pd.Series:
        half = max(2, round(n / 2))
        sqn  = max(2, round(np.sqrt(n)))
        return _wma_s(2 * _wma_s(s, half) - _wma_s(s, n), sqn)

    def _kahlman_s(s: pd.Series, gain: float) -> pd.Series:
        result = np.full(len(s), np.nan)
        kf, vel = np.nan, 0.0
        for idx, v in enumerate(s.values):
            if np.isnan(v):
                continue
            if np.isnan(kf):
                kf = v; result[idx] = v; continue
            dist = v - kf
            err  = dist * np.sqrt(gain * 2)
            vel  = vel + gain * dist
            kf   = kf + err + vel
            result[idx] = kf
        return pd.Series(result, index=s.index)

    # Use hl2 source if OHLC available
    src = ((data["High"] + data["Low"]) / 2).dropna() if "High" in data.columns else close

    fast_line = _kahlman_s(_hma_s(src, FAST_P), GAIN)
    slow_line = _kahlman_s(_hma_s(src, SLOW_P), GAIN)

    ema200    = close.ewm(span=EMA_LEN, adjust=False).mean()

    # Volume confirmation
    if "Volume" in data.columns and data["Volume"].sum() > 0:
        vol_series = data["Volume"].dropna()
        vol_sma20  = vol_series.rolling(VOL_LEN).mean()
        current_vol   = float(vol_series.iloc[-1])
        current_vol_avg = float(vol_sma20.iloc[-1]) if not np.isnan(vol_sma20.iloc[-1]) else current_vol
        vol_ratio = round(current_vol / current_vol_avg, 2) if current_vol_avg > 0 else 1.0
        vol_ok = current_vol > current_vol_avg
    else:
        current_vol = current_vol_avg = 0
        vol_ratio = 1.0
        vol_ok = True   # treat as confirmed when no volume data

    # Latest values
    price     = float(close.iloc[-1])
    fast_k    = float(fast_line.ffill().iloc[-1])
    slow_k    = float(slow_line.ffill().iloc[-1])
    ema200_v  = float(ema200.iloc[-1])

    hma_cross    = fast_k > slow_k
    above_ema200 = price > ema200_v

    confirmations = {
        "hma_cross":    bool(hma_cross),
        "above_ema200": bool(above_ema200),
        "volume_ok":    bool(vol_ok),
    }
    confirm_count = sum(confirmations.values())

    # Signal: BUY needs all 3; SELL on crossover reversal only
    if hma_cross and above_ema200 and vol_ok:
        signal = "BUY"
    elif not hma_cross:
        signal = "SELL"
    else:
        signal = "HOLD"

    return {
        "symbol":        symbol,
        "price":         round(price, 2),
        "signal":        signal,
        "fast_k":        round(fast_k, 4),
        "slow_k":        round(slow_k, 4),
        "ema200":        round(ema200_v, 4),
        "volume":        int(current_vol),
        "volume_sma20":  int(current_vol_avg),
        "volume_ratio":  vol_ratio,
        "confirmations": confirmations,
        "confirm_count": confirm_count,
        "interval":      interval,
        "timestamp":     datetime.now().isoformat(),
    }


@app.get("/api/pltr-signal")
async def get_pltr_signal(symbol: str = "PLTR", interval: str = "1d"):
    """
    Returns the current live HMA-Kahlman Triple-Confirm signal for any ticker.
    Each of the 3 confirmations is calculated independently from real market data:
      1. HMA-K fast(14) > slow(22)  - crossover direction
      2. Price > 200 EMA            - trend filter (long bias only)
      3. Volume > 20-bar avg        - momentum/participation filter
    """
    try:
        result = _compute_live_hmak_signal(symbol=symbol, interval=interval)
        return result
    except Exception as e:
        print(f"[WARN] /api/pltr-signal error for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------------------
# /api/auto-trade/pltr  - check signal and execute trade against Supabase portfolio
# ------------------------------------------------------------------------------

class AutoTradeRequest(BaseModel):
    symbol: str = "PLTR"
    allocation_pct: float = 0.5   # fraction of available cash to allocate on BUY
    interval: str = "1d"
    dry_run: bool = False          # if True, simulate only - don't update Supabase

@app.post("/api/auto-trade/pltr")
async def auto_trade_pltr(request: AutoTradeRequest = None):
    """
    Daily auto-trade bot endpoint.
    - BUY when all 3 HMA-K confirmations are active and no PLTR position exists
    - SELL when crossover turns bearish and a PLTR position exists
    - HOLD otherwise
    Updates Supabase portfolio positions if a trade is executed (unless dry_run=True).
    """
    if request is None:
        request = AutoTradeRequest()

    try:
        # 1. Get live signal
        sig_data = _compute_live_hmak_signal(symbol=request.symbol, interval=request.interval)
        signal       = sig_data["signal"]
        price        = sig_data["price"]
        confirmations= sig_data["confirmations"]
        confirm_count= sig_data["confirm_count"]

        # 2. Load current portfolio from Supabase
        if not supabase_db.available:
            raise HTTPException(status_code=503, detail="Supabase not configured")

        sb_row = await supabase_db.get_portfolio()
        if not sb_row:
            raise HTTPException(status_code=404, detail="Portfolio not found in Supabase")

        pd_data   = sb_row.get("portfolio_data", {})
        portfolio = pd_data.get("portfolio", {})
        positions = portfolio.get("positions", {})
        cash      = float(portfolio.get("cash", 0.0))

        # Infer cash if not explicitly stored (use initial_capital minus invested)
        if cash == 0:
            initial_capital = float(pd_data.get("initial_capital", 100000.0))
            total_invested  = sum(float(p.get("shares", 0)) * float(p.get("avg_cost", 0))
                                  for p in positions.values())
            cash = max(0.0, initial_capital - total_invested)

        has_pltr = request.symbol in positions

        # 3. Decision logic ---------------------------------------------------
        action = "HOLD"
        shares_traded = 0.0
        trade_value   = 0.0
        reason        = ""

        if signal == "BUY" and not has_pltr:
            alloc_cash = cash * request.allocation_pct
            if alloc_cash < price:
                action = "INSUFFICIENT_CASH"
                reason = f"Need at least ${price:.2f} but only ${alloc_cash:.2f} available"
            else:
                shares_traded = alloc_cash / price
                trade_value   = shares_traded * price
                action        = "BUY"
                reason        = f"All {confirm_count}/3 confirmations active"

        elif signal == "SELL" and has_pltr:
            pos = positions[request.symbol]
            shares_traded = float(pos.get("shares", 0))
            trade_value   = shares_traded * price
            action        = "SELL"
            reason        = "HMA-K crossover turned bearish"

        elif signal == "BUY" and has_pltr:
            action = "ALREADY_POSITIONED"
            reason = f"Already holding {positions[request.symbol].get('shares', 0):.2f} shares of {request.symbol}"

        else:
            reason = f"Signal={signal} | Confirmations={confirm_count}/3 active"

        # 4. Update Supabase if a real trade was executed ---------------------
        new_positions = dict(positions)  # copy

        if not request.dry_run and action in ("BUY", "SELL"):
            if action == "BUY":
                new_positions[request.symbol] = {
                    "shares":   round(shares_traded, 6),
                    "avg_cost": round(price, 4),
                }
                new_cash = cash - trade_value
            else:  # SELL
                del new_positions[request.symbol]
                new_cash = cash + trade_value

            # Persist updated positions
            pd_data.setdefault("portfolio", {})["positions"] = new_positions
            pd_data["portfolio"]["cash"] = round(new_cash, 4)
            await supabase_db.update_portfolio(sb_row["id"], pd_data)
            print(f"[INFO] Auto-trade executed: {action} {shares_traded:.4f} {request.symbol} @ ${price:.2f}")
        else:
            new_cash = cash

        # 5. Build response ----------------------------------------------------
        pltr_pos = new_positions.get(request.symbol)
        return {
            "action":         action,
            "symbol":         request.symbol,
            "signal":         signal,
            "price":          price,
            "shares":         round(shares_traded, 4),
            "value":          round(trade_value, 2),
            "reason":         reason,
            "confirmations":  confirmations,
            "confirm_count":  confirm_count,
            "dry_run":        request.dry_run,
            "portfolio_after": {
                "cash":          round(new_cash, 2),
                "pltr_shares":   round(float(pltr_pos["shares"]), 4) if pltr_pos else 0,
                "pltr_value":    round(float(pltr_pos["shares"]) * price, 2) if pltr_pos else 0,
            },
            "timestamp": datetime.now().isoformat(),
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[WARN] auto-trade error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# SIGNAL EMAIL ALERTS
# ============================================================================

class SignalAlertRequest(BaseModel):
    """Request body for sending signal alerts."""
    symbol: str
    signal: str  # "BUY", "SELL", "HOLD"
    price: float
    strategy: str = "HMA-Kahlman"
    confirmations: Optional[Dict[str, bool]] = None
    confirm_count: Optional[int] = None
    fast_k: Optional[float] = None
    slow_k: Optional[float] = None
    volume_ratio: Optional[float] = None
    include_portfolio: bool = True
    include_history: bool = True


@app.post("/api/send-signal-alert")
async def send_signal_alert_endpoint(request: SignalAlertRequest):
    """
    Send email alert when a signal is detected.
    Includes deduplication to avoid spam.

    Returns:
    {
        "success": bool,
        "email_sent": bool,
        "message": str,
        "reason": str,  # "duplicate_signal", "alerts_disabled", "sent", etc.
        "signal_key": str
    }
    """

    try:
        # 1. Check if email alerts enabled
        if not email_config.is_ready():
            return {
                "success": False,
                "email_sent": False,
                "message": "Email service not configured",
                "reason": "alerts_disabled",
                "signal_key": f"{request.symbol}_{request.strategy.replace(' ', '_')}"
            }

        # 2. Create signal key for deduplication
        signal_key = f"{request.symbol}_{request.strategy.replace(' ', '_')}"

        # 3. Load signal state and check for duplicates
        signal_state = load_signal_state()
        if is_duplicate_alert(signal_state, signal_key, request.signal, hours_threshold=4):
            print(f"[INFO] Duplicate alert skipped: {signal_key} = {request.signal}")
            return {
                "success": True,
                "email_sent": False,
                "message": f"Signal {request.signal} already alerted in last 4 hours",
                "reason": "duplicate_signal",
                "signal_key": signal_key
            }

        # 4. Get portfolio data if requested
        portfolio_html = ""
        if request.include_portfolio:
            try:
                sb_row = await supabase_db.get_portfolio()
                if sb_row:
                    pd_data = sb_row.get("portfolio_data", {})
                    positions = pd_data.get("portfolio", {}).get("positions", {})
                    cash = pd_data.get("portfolio", {}).get("cash", 0)
                    initial_capital = pd_data.get("initial_capital", 100000)

                    # Build portfolio HTML
                    portfolio_html = f"""
                    <h3 style="color: #0066cc; margin-top: 20px;">[Portfolio] Snapshot</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 8px; border: 1px solid #ddd;"><b>Position</b></td>
                            <td style="padding: 8px; border: 1px solid #ddd;"><b>Shares</b></td>
                            <td style="padding: 8px; border: 1px solid #ddd;"><b>Avg Cost</b></td>
                            <td style="padding: 8px; border: 1px solid #ddd;"><b>Value</b></td>
                        </tr>
                    """
                    for sym, pos in positions.items():
                        portfolio_html += f"""
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd;">{sym}</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">{pos.get('shares', 0):.4f}</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${pos.get('avg_cost', 0):.2f}</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${pos.get('shares', 0) * pos.get('avg_cost', 0):.2f}</td>
                        </tr>
                        """
                    portfolio_html += f"""
                        <tr style="background: #f5f5f5; font-weight: bold;">
                            <td style="padding: 8px; border: 1px solid #ddd;">Cash</td>
                            <td colspan="3" style="padding: 8px; border: 1px solid #ddd;">${cash:,.2f}</td>
                        </tr>
                    </table>
                    <p style="font-size: 12px; color: #666; margin-top: 10px;">Initial Capital: ${initial_capital:,.2f}</p>
                    """
            except Exception as e:
                print(f"[WARN] Could not fetch portfolio for alert: {e}")

        # 5. Get signal history context if requested
        history_html = ""
        if request.include_history:
            history_html = """
            <h3 style="color: #0066cc; margin-top: 20px;">[Signal] Context</h3>
            <p style="font-size: 13px;">
                <b>HMA-Kahlman Triple-Confirm Strategy:</b><br>
                • Signals with 3/3 confirmations historically win ~78% of trades<br>
                • Average hold period: 12-15 trading days<br>
                • Max recent drawdown on similar signals: -3.5%
            </p>
            """

        # 6. Format signal details
        confirmations_html = ""
        if request.confirmations:
            confirmations_html = f"""
            <h4 style="color: #333; margin-top: 15px;">[Confirmations] ({request.confirm_count}/3)</h4>
            <ul style="font-size: 13px; margin: 5px 0;">
                <li>HMA Cross: {'YES' if request.confirmations.get('hma_cross') else 'NO'}</li>
                <li>Price > 200 EMA: {'YES' if request.confirmations.get('above_ema200') else 'NO'}</li>
                <li>Volume Ratio: {'YES' if request.confirmations.get('volume_ok') else 'NO'} ({f"{request.volume_ratio:.2f}x" if request.volume_ratio else "N/A"})</li>
            </ul>
            """

        # 7. Build HTML email
        signal_color = "#28a745" if request.signal == "BUY" else "#dc3545" if request.signal == "SELL" else "#ffc107"
        html_body = f"""
        <html>
            <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                <div style="max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; padding: 20px; background: #f9f9f9;">

                    <!-- Header -->
                    <h2 style="color: #0066cc; margin: 0;">PLTR Trading Signal Alert</h2>
                    <p style="color: #666; margin-top: 5px;">{datetime.now().strftime('%B %d, %Y at %I:%M %p')} EDT</p>

                    <!-- Signal Badge -->
                    <div style="background: {signal_color}; color: white; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0;">
                        <h3 style="margin: 0; font-size: 24px;">{request.signal}</h3>
                        <p style="margin: 5px 0; font-size: 12px;">Current Price: <b>${request.price:.2f}</b></p>
                    </div>

                    <!-- Signal Details -->
                    <h3 style="color: #0066cc;">📋 Signal Details</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 8px; border: 1px solid #ddd;"><b>Metric</b></td>
                            <td style="padding: 8px; border: 1px solid #ddd;"><b>Value</b></td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd;">Strategy</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">{request.strategy}</td>
                        </tr>
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 8px; border: 1px solid #ddd;">Symbol</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">{request.symbol}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd;">Price</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${request.price:.2f}</td>
                        </tr>
                        {f'<tr style="background: #f5f5f5;"><td style="padding: 8px; border: 1px solid #ddd;">Fast K</td><td style="padding: 8px; border: 1px solid #ddd;">{request.fast_k:.2f}</td></tr>' if request.fast_k else ''}
                        {f'<tr><td style="padding: 8px; border: 1px solid #ddd;">Slow K</td><td style="padding: 8px; border: 1px solid #ddd;">{request.slow_k:.2f}</td></tr>' if request.slow_k else ''}
                    </table>

                    {confirmations_html}

                    {portfolio_html}

                    {history_html}

                    <!-- Action Recommendation -->
                    <div style="background: #e7f3ff; border-left: 4px solid #0066cc; padding: 15px; margin: 20px 0; border-radius: 4px;">
                        <h4 style="color: #0066cc; margin-top: 0;">[Recommendation]</h4>
                        {f"<p><b>STRONG {request.signal}</b> - All confirmations active. Consider 50% cash allocation.</p>" if request.confirm_count == 3 else f"<p>{request.signal} signal. Monitor for full confirmation.</p>"}
                    </div>

                    <!-- Auto-Trade Notice -->
                    <p style="font-size: 11px; color: #999; background: #f5f5f5; padding: 10px; border-radius: 4px; margin: 20px 0;">
                        [INFO] <b>Auto-Trade Bot Notice:</b> Your auto-trade bot is enabled. This trade may execute automatically based on signal confirmation.<br>
                        📧 Next alert check: 9:34 AM EDT (peak volatility window)
                    </p>

                    <!-- Footer -->
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                    <p style="font-size: 11px; color: #999; text-align: center; margin: 10px 0;">
                        Stock Analysis Platform<br>
                        Real-time portfolio tracking and market analysis
                    </p>

                </div>
            </body>
        </html>
        """

        # 8. Plain text fallback
        text_body = f"""
PLTR TRADING SIGNAL ALERT
{datetime.now().strftime('%B %d, %Y at %I:%M %p')} EDT

Signal: {request.signal}
Price: ${request.price:.2f}
Strategy: {request.strategy}
Confirmations: {request.confirm_count}/3

Auto-trade bot is enabled. This trade may execute automatically.
Next alert check: 9:34 AM EDT
        """

        # 9. Send email
        subject = f"PLTR {request.signal} Signal @ ${request.price:.2f} - {datetime.now().strftime('%H:%M')} ET"
        email_result = await send_email_alert(email_config, subject, html_body, text_body)

        # 10. Update signal state if email sent
        if email_result["success"]:
            signal_state[signal_key] = {
                "signal": request.signal,
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "price": request.price
            }
            save_signal_state(signal_state)

        return {
            "success": email_result["success"],
            "email_sent": email_result["success"],
            "message": email_result["message"],
            "reason": "sent" if email_result["success"] else "email_failed",
            "signal_key": signal_key
        }

    except Exception as e:
        error_msg = str(e).encode('ascii', 'replace').decode('ascii')
        print(f"[ERROR] send_signal_alert_endpoint: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)


@app.get("/api/strategy-signals/{strategy_id}")
async def get_strategy_signals(strategy_id: str, mode: str = "terminal", lookback: int = 0):
    """Get current signals for a strategy

    Args:
        strategy_id: 'dual_momentum' to get dual momentum signal
        mode: 'terminal' for Terminal Strategy or 'basic' for simple momentum
        lookback: custom lookback period in days (0 = use mode default)
    """
    try:
        if strategy_id == "dual_momentum":
            # User can request specific strategy mode
            prefer_terminal = mode == "terminal"

            # Try Terminal Strategy first if requested (superior performance: +346.87% vs basic strategy)
            if prefer_terminal and TQQQ_STRATEGY_AVAILABLE:
                try:
                    print(f"[INFO] Using TQQQ Terminal Strategy for live signal")
                    signal_data = get_tqqq_signal()
                    return {
                        "strategy": "dual_momentum_terminal",
                        "signal": signal_data,
                        "source": "TQQQ Terminal Strategy (346.87% 3-year return)",
                        "timestamp": datetime.now().isoformat()
                    }
                except Exception as e:
                    print(f"[WARN] Terminal strategy failed: {e}, falling back to basic...")

            # Fallback: Calculate momentum signal
            # Asset universe: TQQQ, QQQ (equities), GLD (safe), BIL (cash)
            # Lookback: custom param, or 21 for terminal, 126 for basic
            assets = ["TQQQ", "QQQ", "GLD", "BIL"]
            lookback_days = lookback if lookback > 0 else (21 if prefer_terminal else 126)
            # Download enough data for the lookback + buffer
            download_period = "2y" if lookback_days > 180 else "1y" if lookback_days > 90 else "180d"
            try:
                data = yf.download(assets, period=download_period, progress=False, interval="1d")

                if isinstance(data.columns, pd.MultiIndex):
                    # Multi-ticker: flatten columns
                    data.columns = ['_'.join(col).strip() for col in data.columns.values]

                # Calculate momentum over lookback period
                momenta = {}
                for asset in assets:
                    col = f"Close_{asset}" if f"Close_{asset}" in data.columns else "Close"
                    if col in data.columns:
                        prices = data[col]
                        if len(prices) >= lookback_days:
                            momentum = float((prices.iloc[-1] / prices.iloc[-lookback_days] - 1) * 100)
                            momenta[asset] = round(momentum, 2)

                # Build normalized price history for chart (rebase to 100)
                price_history = []
                lookback_prices = {}
                for asset in assets:
                    col = f"Close_{asset}" if f"Close_{asset}" in data.columns else "Close"
                    if col in data.columns:
                        prices = data[col].dropna()
                        if len(prices) >= lookback_days:
                            sliced = prices.iloc[-lookback_days:]
                            base = float(sliced.iloc[0])
                            lookback_prices[asset] = [(float(p) / base) * 100 for p in sliced.values]

                if lookback_prices:
                    # Get dates from the index
                    sample_col = f"Close_{assets[0]}" if f"Close_{assets[0]}" in data.columns else "Close"
                    dates = data.index[-lookback_days:]
                    for i in range(lookback_days):
                        entry = {"date": dates[i].strftime("%b %d")}
                        for asset in assets:
                            if asset in lookback_prices and i < len(lookback_prices[asset]):
                                entry[asset] = round(lookback_prices[asset][i], 2)
                        price_history.append(entry)

                # Dual momentum decision logic:
                # 1. Filter tradeable assets with positive momentum (exclude BIL - it's the cash fallback)
                tradeable = {k: v for k, v in momenta.items() if v > 0 and k != "BIL"}

                # 2. Pick asset with the highest positive momentum
                if tradeable:
                    signal = max(tradeable, key=tradeable.get)
                else:
                    signal = "BIL"  # All negative or flat -> hold cash

                return {
                    "strategy": f"dual_momentum_{'terminal' if prefer_terminal else 'basic'}",
                    "signal": signal,
                    "momenta": momenta,
                    "price_history": price_history,
                    "lookback_days": lookback_days,
                    "source": f"yfinance momentum ({lookback_days}-day lookback)",
                    "timestamp": datetime.now().isoformat()
                }
            except Exception as e:
                print(f"Error calculating basic momentum: {e}")
                # Fallback: return TQQQ if calculation fails
                return {
                    "strategy": "dual_momentum_basic",
                    "signal": "TQQQ",
                    "timestamp": datetime.now().isoformat(),
                    "note": "Fallback signal due to calculation error"
                }
        else:
            raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------------------------------------------------------------------
# /api/earnings  - upcoming earnings dates via yfinance .calendar
# /api/news/{symbol} - real news headlines + Grok-powered bullish/bearish summary
# ------------------------------------------------------------------------------

XAI_API_KEY  = os.getenv("XAI_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")


async def _llm_news_summary(symbol: str, headlines: list[str]) -> dict:
    """
    Call Grok (xAI) to produce a bullish/bearish summary from raw headlines.
    Falls back to Groq (llama-3.3-70b) if xAI fails.
    Returns: {sentiment, bullets: [{type:'bull'|'bear', text:str}]}
    """
    prompt = (
        f"You are a concise financial analyst. Here are recent news headlines for {symbol}:\n\n"
        + "\n".join(f"- {h}" for h in headlines[:12])
        + "\n\nRespond with ONLY valid JSON in this exact format, no markdown, no extra text:\n"
        '{"sentiment":"bullish"|"bearish"|"mixed",'
        '"bullets":[{"type":"bull","text":"..."},{"type":"bear","text":"..."}]}'
        "\n\nProvide 2-3 bullish and 1-2 bearish bullets, each max 12 words. Be specific to the headlines."
    )

    async def _call(base_url: str, key: str, model: str) -> dict:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"model": model, "messages": [{"role": "user", "content": prompt}],
                      "temperature": 0.3, "max_tokens": 400},
            )
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"].strip()
            # Strip any accidental markdown fencing
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            return json.loads(content)

    # Try Grok first
    if XAI_API_KEY:
        try:
            return await _call("https://api.x.ai/v1", XAI_API_KEY, "grok-3-mini")
        except Exception as e:
            print(f"[WARN] Grok failed for {symbol}: {e}")

    # Fallback to Groq
    if GROQ_API_KEY:
        try:
            return await _call("https://api.groq.com/openai/v1", GROQ_API_KEY, "llama-3.3-70b-versatile")
        except Exception as e:
            print(f"[WARN] Groq failed for {symbol}: {e}")

    raise HTTPException(status_code=503, detail="No LLM API key configured")


@app.get("/api/earnings-debug")
async def get_earnings_debug(symbol: str = "PLTR"):
    """Debug endpoint - shows raw earningsHistory via yfinance internal session."""
    ticker = yf.Ticker(symbol)
    yf_url = (
        f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"
        f"?modules=earningsHistory"
    )
    js = ticker._data.get_raw_json(yf_url)
    history = (
        js.get("quoteSummary", {})
          .get("result", [{}])[0]
          .get("earningsHistory", {})
          .get("history", [])
    )
    return {"history_count": len(history), "history": history}


@app.get("/api/earnings")
async def get_earnings(symbols: str = "PLTR,NVDA,MSFT,ORCL,AVGO,POET"):
    """
    Returns upcoming earnings dates + last quarter beat/miss for each symbol.
    - upcoming: date, eps_est (next quarter estimate)
    - last result: actual EPS vs estimate, surprise %, beat/miss/inline
    """
    results = []
    for sym in [s.strip().upper() for s in symbols.split(",") if s.strip()]:
        try:
            ticker = yf.Ticker(sym)

            # -- Upcoming earnings date + estimate ----------------------------
            cal      = ticker.calendar
            date_str = None
            eps_est  = None

            if isinstance(cal, dict):
                ed = cal.get("Earnings Date")
                if ed:
                    first    = ed[0] if isinstance(ed, (list, tuple)) else ed
                    date_str = str(first)[:10]
                eps_est = cal.get("Earnings Average") or cal.get("EPS Estimate")
            elif hasattr(cal, "iloc"):
                try:
                    date_str = str(cal.iloc[0, 0])[:10]
                except Exception:
                    pass

            # -- Last quarter beat / miss -------------------------------------
            last_actual   = None
            last_est      = None
            surprise_pct  = None
            beat_miss     = None   # "beat" | "miss" | "inline"

            try:
                # Use yfinance internal session (handles crumb/cookie automatically)
                # quoteSummary earningsHistory gives quarterly EPS actual vs estimate
                yf_url = (
                    f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}"
                    f"?modules=earningsHistory"
                )
                js = ticker._data.get_raw_json(yf_url)
                history = (
                    js.get("quoteSummary", {})
                      .get("result", [{}])[0]
                      .get("earningsHistory", {})
                      .get("history", [])
                )
                # Sort by quarter timestamp descending → most recent first
                history_sorted = sorted(
                    history,
                    key=lambda e: e.get("quarter", {}).get("raw", 0),
                    reverse=True
                )
                for entry in history_sorted:
                    actual_raw = entry.get("epsActual", {}).get("raw")
                    est_raw    = entry.get("epsEstimate", {}).get("raw")
                    surp_raw   = entry.get("surprisePercent", {}).get("raw")
                    if actual_raw is not None:
                        last_actual  = float(actual_raw)
                        last_est     = float(est_raw)           if est_raw   is not None else None
                        # surprisePercent raw is decimal (0.155 = 15.5%), convert to %
                        surprise_pct = float(surp_raw) * 100    if surp_raw  is not None else None
                        if last_est is not None and last_est != 0:
                            if surprise_pct is None:
                                surprise_pct = (last_actual - last_est) / abs(last_est) * 100
                            if last_actual > last_est * 1.005:
                                beat_miss = "beat"
                            elif last_actual < last_est * 0.995:
                                beat_miss = "miss"
                            else:
                                beat_miss = "inline"
                        break   # only need most recent reported quarter
            except Exception as e:
                print(f"[WARN] earningsHistory fetch for {sym}: {e}")

            results.append({
                "symbol":        sym,
                "date":          date_str,
                "eps_est":       round(float(eps_est), 4) if eps_est is not None else None,
                "confirmed":     date_str is not None,
                "last_actual":   round(last_actual,   4) if last_actual  is not None else None,
                "last_est":      round(last_est,       4) if last_est     is not None else None,
                "surprise_pct":  round(surprise_pct,  2) if surprise_pct is not None else None,
                "beat_miss":     beat_miss,
            })
        except Exception as e:
            print(f"[WARN] earnings fetch failed for {sym}: {e}")
            results.append({
                "symbol": sym, "date": None, "eps_est": None, "confirmed": False,
                "last_actual": None, "last_est": None, "surprise_pct": None, "beat_miss": None,
            })

    return {"earnings": results}


@app.get("/api/news/{symbol}")
async def get_news_summary(symbol: str):
    """
    Fetches recent yfinance news headlines for symbol, then asks Grok to
    classify them into bullish/bearish bullets. Returns structured JSON.
    """
    symbol = symbol.upper()
    try:
        ticker  = yf.Ticker(symbol)
        raw     = ticker.news or []

        headlines = []
        articles  = []
        for item in raw[:15]:
            # yfinance 1.2.0 nests content under 'content' key
            content = item.get("content", item)
            title   = (content.get("title") or item.get("title") or "").strip()
            url     = (
                (content.get("canonicalUrl") or {}).get("url")
                or content.get("link")
                or item.get("link", "")
            )
            publisher = (
                (content.get("provider") or {}).get("displayName")
                or content.get("publisher")
                or item.get("publisher", "")
            )
            pub_date = content.get("pubDate") or item.get("providerPublishTime", "")
            if isinstance(pub_date, (int, float)):
                from datetime import timezone
                pub_date = datetime.fromtimestamp(pub_date, tz=timezone.utc).strftime("%Y-%m-%d")
            elif isinstance(pub_date, str) and len(pub_date) > 10:
                pub_date = pub_date[:10]

            if title:
                headlines.append(title)
                articles.append({"title": title, "url": url, "publisher": publisher, "date": pub_date})

        if not headlines:
            raise HTTPException(status_code=404, detail=f"No news found for {symbol}")

        summary = await _llm_news_summary(symbol, headlines)
        return {
            "symbol":    symbol,
            "sentiment": summary.get("sentiment", "mixed"),
            "bullets":   summary.get("bullets", []),
            "articles":  articles[:8],
            "generated": datetime.now().isoformat(),
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[WARN] /api/news/{symbol} error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------------------
# /api/macro-data - Oil (CL=F) + US Dollar Index (DX-Y.NYB) price history
# /api/news/market - aggregated macro news for the news page
# ------------------------------------------------------------------------------

MACRO_SYMBOLS = {
    "oil": {"ticker": "CL=F",      "name": "WTI Crude Oil",    "unit": "$/bbl"},
    "dxy": {"ticker": "DX-Y.NYB",  "name": "US Dollar Index",  "unit": "Index"},
}

@app.get("/api/macro-data")
async def get_macro_data(period: str = "6mo"):
    """
    Returns price history + current value for WTI Crude Oil and US Dollar Index.
    period: 1mo | 3mo | 6mo | 1y
    """
    result = {}
    for key, meta in MACRO_SYMBOLS.items():
        try:
            hist = yf.Ticker(meta["ticker"]).history(period=period, interval="1d")
            if hist.empty:
                result[key] = {**meta, "error": "No data", "series": [], "current": None, "change_pct": 0}
                continue
            series = [
                {"date": str(dt)[:10], "price": round(float(row["Close"]), 2)}
                for dt, row in hist.iterrows()
            ]
            current  = series[-1]["price"] if series else None
            prev     = series[-2]["price"] if len(series) >= 2 else current
            chg_pct  = round((current - prev) / prev * 100, 2) if prev else 0
            week_ago = series[-6]["price"] if len(series) >= 6 else series[0]["price"]
            month_ago= series[-22]["price"] if len(series) >= 22 else series[0]["price"]
            result[key] = {
                **meta,
                "current":    current,
                "change_pct": chg_pct,
                "week_chg":   round((current - week_ago)  / week_ago  * 100, 2) if week_ago  else 0,
                "month_chg":  round((current - month_ago) / month_ago * 100, 2) if month_ago else 0,
                "series":     series,
            }
        except Exception as e:
            print(f"[WARN] macro-data {key}: {e}")
            result[key] = {**meta, "error": str(e), "series": [], "current": None, "change_pct": 0}
    return result


# News page categories → symbol mappings
NEWS_CATEGORIES = {
    "market":      {"symbols": ["SPY"],  "label": "Market Overview",    "color": "blue"},
    "oil":         {"symbols": ["XOM"],  "label": "Oil & Energy",        "color": "amber"},
    "geopolitics": {"symbols": ["GLD"],  "label": "Geopolitics & War",   "color": "yellow"},
    "defense":     {"symbols": ["LMT"],  "label": "Defense",             "color": "red"},
    "tech":        {"symbols": ["NVDA"], "label": "Tech & AI",           "color": "purple"},
    "pltr":        {"symbols": ["PLTR"], "label": "Palantir",            "color": "green"},
}

@app.get("/api/news-categories")
async def get_news_categories():
    """Returns the available news categories and their symbol mappings."""
    return {"categories": [
        {"id": k, "label": v["label"], "symbols": v["symbols"], "color": v["color"]}
        for k, v in NEWS_CATEGORIES.items()
    ]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
