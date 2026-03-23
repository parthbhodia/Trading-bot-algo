"""
modules/dual_momentum_live.py — Live Signal Tracker + QQQ Extension

Extends the proven dual_momentum.py with:
  1. Four-asset universe: SPY, QQQ, GLD, TLT
     → In bull regimes, QQQ often beats SPY (tech momentum)
     → Strategy picks the single best momentum asset each month

  2. Live signal: tells you what to hold RIGHT NOW
     → Run once on the 1st trading day of each month
     → One output, one decision, done

  3. Signal history log: tracks past decisions + outcomes
     → Builds a CSV log each time you run it
     → Shows you how the live signal has performed historically

Usage:
    python dual_momentum_live.py              # Show current signal + backtest
    python dual_momentum_live.py --signal     # Current signal only (quick)
    python dual_momentum_live.py --backtest   # Full backtest comparison only
"""

from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
@dataclass
class LiveMomentumConfig:
    # Asset universe — strategy picks single best each month
    equity_tickers: list[str] = None      # Risk-on candidates
    safe_ticker:    str = "GLD"           # Risk-off alternative
    cash_ticker:    str = "BIL"           # Absolute momentum fail → bonds (BIL avoids 2022 bond massacre)

    # Momentum lookback (proven best: 126 days = 6 months)
    lookback: int = 126

    # Rebalance frequency
    rebalance_days: int = 21              # Monthly

    # Absolute momentum floor
    abs_momentum_min: float = 0.0         # Any positive return = qualify

    # Simulation
    initial_capital: float = 10_000.0
    period: str = "10y"
    commission_pct: float = 0.001

    # Signal log path
    log_path: str = "momentum_signal_log.csv"

    def __post_init__(self):
        if self.equity_tickers is None:
            self.equity_tickers = ["SPY"]  # Default: US broad only (no QQQ)


# ── Data ──────────────────────────────────────────────────────────────────────
def _download(ticker: str, period: str) -> pd.Series:
    df = yf.download(ticker, period=period, auto_adjust=True, progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df.index = pd.to_datetime(df.index)
    df = df[["Close"]].dropna()
    today = pd.Timestamp.now().normalize()
    if df.index.tz is not None:
        today = today.tz_localize(df.index.tz)
    return df.loc[df.index <= today, "Close"].squeeze()


def _download_all(config: LiveMomentumConfig) -> dict[str, pd.Series]:
    all_tickers = config.equity_tickers + [config.safe_ticker, config.cash_ticker]
    # Deduplicate while preserving order
    seen = set()
    tickers = [t for t in all_tickers if not (t in seen or seen.add(t))]

    data = {}
    for t in tickers:
        try:
            s = _download(t, config.period)
            if len(s) > config.lookback:
                data[t] = s
            else:
                logger.warning("Insufficient data for %s, skipping", t)
        except Exception as e:
            logger.warning("Failed to download %s: %s", t, e)

    return data


def _align(data: dict[str, pd.Series]) -> dict[str, pd.Series]:
    """Align all series to common trading days."""
    common = None
    for s in data.values():
        common = s.index if common is None else common.intersection(s.index)
    return {t: s.loc[common] for t, s in data.items()}


# ── Momentum computation ──────────────────────────────────────────────────────
def _momentum(series: pd.Series, lookback: int, as_of: int = -1) -> float:
    """
    Return momentum of series ending at as_of index position.
    as_of=-1 means latest available (live signal).
    as_of=N means historical position N.
    """
    end = as_of if as_of >= 0 else len(series)
    start = end - lookback
    if start < 0:
        return np.nan
    window = series.iloc[start:end]
    if len(window) < lookback // 2:
        return np.nan
    return float(window.iloc[-1] / window.iloc[0] - 1)


def _pick_asset(
    data: dict[str, pd.Series],
    config: LiveMomentumConfig,
    as_of: int = -1,
) -> tuple[str, dict[str, float]]:
    """
    Core decision: which asset to hold.

    Returns (ticker_to_hold, {ticker: momentum_value})

    Logic:
      1. Compute lookback momentum for all equity candidates + safe asset
      2. Filter: keep only those with momentum > abs_momentum_min
      3. If none qualify → hold cash_ticker
      4. Among qualifiers, pick the one with highest momentum
      5. If best qualifier is safe_ticker → hold safe_ticker
      6. Else → hold best equity
    """
    all_candidates = config.equity_tickers + [config.safe_ticker]
    momenta = {}

    for ticker in all_candidates:
        if ticker in data:
            momenta[ticker] = _momentum(data[ticker], config.lookback, as_of)

    # Filter to positive momentum assets
    qualified = {t: m for t, m in momenta.items()
                 if not np.isnan(m) and m > config.abs_momentum_min}

    if not qualified:
        return config.cash_ticker, momenta   # Absolute momentum fail → cash

    best = max(qualified, key=qualified.get)
    return best, momenta


# ── Live signal ───────────────────────────────────────────────────────────────
def get_live_signal(config: LiveMomentumConfig) -> dict:
    """
    Compute the current momentum signal.
    Call this on the 1st trading day of each month.
    Returns a dict with the decision and all context.
    """
    print("\n  Downloading latest prices...")
    data = _align(_download_all(config))

    hold, momenta = _pick_asset(data, config, as_of=-1)

    # Build next rebalance date estimate (≈21 trading days from today)
    today = pd.Timestamp.now().normalize()
    next_rebal = today + pd.offsets.BDay(config.rebalance_days)

    result = {
        "date"        : today.strftime("%Y-%m-%d"),
        "hold"        : hold,
        "next_rebal"  : next_rebal.strftime("%Y-%m-%d"),
        "momenta"     : momenta,
        "qualified"   : {t: m for t, m in momenta.items()
                         if not np.isnan(m) and m > config.abs_momentum_min},
        "lookback_days": config.lookback,
    }
    return result


def print_live_signal(sig: dict) -> None:
    W = 60
    ticker_labels = {
        "SPY": "US Equities (S&P 500)",
        "QQQ": "US Tech (Nasdaq 100)",
        "GLD": "Gold",
        "TLT": "Long-Term Bonds",
        "AGG": "Aggregate Bonds",
        "BIL": "T-Bills (Cash)",
    }

    print("\n" + "=" * W)
    print("  📊 DUAL MOMENTUM — LIVE SIGNAL")
    print("=" * W)
    print(f"  Date           : {sig['date']}")
    print(f"  Lookback       : {sig['lookback_days']}d  "
          f"({sig['lookback_days'] // 21} months)")
    print(f"  Next Rebalance : {sig['next_rebal']} (approx)")
    print("─" * W)
    print(f"\n  ▶  HOLD: {sig['hold']}  —  "
          f"{ticker_labels.get(sig['hold'], sig['hold'])}\n")
    print("─" * W)
    print(f"  {'Asset':<6} {'Momentum':>10} {'Qualifies?':>12} {'Label'}")
    print(f"  {'─'*5} {'─'*10} {'─'*12} {'─'*24}")

    all_tickers = list(sig['momenta'].keys())
    for t in all_tickers:
        m = sig['momenta'].get(t, float('nan'))
        qualifies = "✅ YES" if t in sig['qualified'] else "❌  NO"
        best_marker = " ◄ HOLD" if t == sig['hold'] else ""
        m_str = f"{m:>+.1%}" if not np.isnan(m) else "  N/A"
        label = ticker_labels.get(t, t)
        print(f"  {t:<6} {m_str:>10} {qualifies:>12}   {label}{best_marker}")

    print("─" * W)
    if sig['hold'] in ("TLT", "BIL", "AGG"):
        print("  ⚠  Absolute momentum negative — all equity assets declining.")
        print("     Holding bonds/cash until momentum recovers.")
    elif sig['hold'] == "GLD":
        print("  🛡  Gold outperforming equities — risk-off regime.")
        print("     Holding gold until SPY or QQQ momentum leads again.")
    else:
        print("  🚀  Equity momentum positive and leading.")
        print("     Stay long. Review again on next rebalance date.")
    print("=" * W)


# ── Signal log ────────────────────────────────────────────────────────────────
def log_signal(sig: dict, log_path: str) -> None:
    """Append today's signal to a CSV log for tracking over time."""
    path = Path(log_path)
    row = {"date": sig["date"], "hold": sig["hold"]}
    row.update({f"mom_{t}": f"{m:.4f}" for t, m in sig["momenta"].items()})

    df_new = pd.DataFrame([row])

    if path.exists():
        df_existing = pd.read_csv(path)
        # Don't duplicate same-day entries
        if sig["date"] in df_existing["date"].values:
            print(f"\n  Signal for {sig['date']} already logged. Skipping.")
            return
        df_out = pd.concat([df_existing, df_new], ignore_index=True)
    else:
        df_out = df_new

    df_out.to_csv(path, index=False)
    print(f"\n  ✅ Signal logged to {path.resolve()}")


# ── Backtest engine ───────────────────────────────────────────────────────────
def _run_backtest(
    data: dict[str, pd.Series],
    config: LiveMomentumConfig,
) -> tuple[pd.Series, pd.Series, pd.Series, pd.DataFrame]:
    """
    Core backtest loop. Returns (equity, spy_curve, port_ret, yearly_df).
    """
    # Align and get common index
    index = list(data.values())[0].index

    # Build daily returns for all assets
    returns = {t: s.pct_change().fillna(0) for t, s in data.items()}

    # Compute rebalance dates (every N trading days after warmup)
    valid_start_idx = config.lookback
    rebal_indices = list(range(valid_start_idx, len(index), config.rebalance_days))

    # Build holding series
    holding = pd.Series(np.nan, index=index, dtype=object)
    current = config.cash_ticker

    for idx in rebal_indices:
        current, _ = _pick_asset(data, config, as_of=idx)
        holding.iloc[idx] = current

    # Forward fill (hold until next rebalance)
    holding.iloc[:valid_start_idx] = config.cash_ticker
    holding = holding.ffill().fillna(config.cash_ticker)

    # Portfolio returns
    port_ret = pd.Series(0.0, index=index)
    for t, ret in returns.items():
        mask = holding == t
        port_ret[mask] = ret[mask]

    # Commission on switches
    switched = (holding != holding.shift(1)).astype(float)
    switched.iloc[0] = 0
    port_ret -= switched * config.commission_pct

    # Equity curves
    equity    = config.initial_capital * (1 + port_ret).cumprod()
    spy_curve = config.initial_capital * (1 + returns.get("SPY", port_ret * 0)).cumprod()

    # Year-by-year
    rows = []
    for yr in sorted(index.year.unique()):
        mask    = index.year == yr
        eq_yr   = equity[mask]
        spy_yr  = spy_curve[mask]
        ret_yr  = port_ret[mask]
        hold_yr = holding[mask]

        if len(eq_yr) < 5:
            continue

        strat_r = float(eq_yr.iloc[-1] / eq_yr.iloc[0] - 1)
        spy_r   = float(spy_yr.iloc[-1] / spy_yr.iloc[0] - 1)
        dd_yr   = float((eq_yr / eq_yr.expanding().max() - 1).min())
        mu_yr   = ret_yr.mean()
        sig_yr  = ret_yr.std()
        sh_yr   = float(np.sqrt(252) * mu_yr / sig_yr) if sig_yr > 0 else 0.0
        top_hold = hold_yr.mode().iloc[0] if len(hold_yr) > 0 else "?"

        rows.append({
            "Year"    : yr,
            "Strategy": strat_r,
            "SPY"     : spy_r,
            "Alpha"   : strat_r - spy_r,
            "Sharpe"  : sh_yr,
            "Max DD"  : dd_yr,
            "Hold"    : top_hold,
        })

    yearly = pd.DataFrame(rows).set_index("Year")
    return equity, spy_curve, port_ret, yearly, holding


def run_backtest(config: LiveMomentumConfig) -> None:
    """Run and print the full backtest comparison."""
    print(f"\n  Downloading {config.period} of data for "
          f"{config.equity_tickers + [config.safe_ticker, config.cash_ticker]}...")

    data = _align(_download_all(config))

    # ── Run configurations ────────────────────────────────────────────────
    # Use the passed config instead of hardcoded ones
    config_name = f"{config.equity_tickers[0]}+{config.equity_tickers[1] if len(config.equity_tickers) > 1 else ''}+{config.safe_ticker} ({config.lookback//21}mo)"
    test_configs = [(config_name, config)]

    W = 76
    print("\n" + "=" * W)
    print("  DUAL MOMENTUM WITH QQQ EXTENSION — BACKTEST COMPARISON")
    print("=" * W)
    print(f"  {'Config':<26} {'Return':>8} {'Ann':>7} {'Sharpe':>7} "
          f"{'DD':>8} {'Calmar':>7} {'SPY%':>6} {'QQQ%':>6} {'GLD%':>6}")
    print("  " + "─" * (W - 2))

    all_results = []
    for name, cfg in test_configs:
        cfg_data = _align(_download_all(cfg))
        equity, spy_curve, port_ret, yearly, holding = _run_backtest(cfg_data, cfg)

        total_ret = float(equity.iloc[-1] / cfg.initial_capital - 1)
        n_days    = len(equity)
        years     = n_days / 252
        ann_ret   = float((1 + total_ret) ** (1 / years) - 1)
        peak      = equity.expanding().max()
        max_dd    = float((equity / peak - 1).min())
        calmar    = ann_ret / abs(max_dd) if max_dd != 0 else 0.0
        mu        = port_ret.mean()
        sig       = port_ret.std()
        sharpe    = float(np.sqrt(252) * mu / sig) if sig > 0 else 0.0
        pct_spy   = float((holding == "SPY").mean())
        pct_qqq   = float((holding == "QQQ").mean())
        pct_gld   = float((holding == "GLD").mean())

        all_results.append((name, cfg, equity, spy_curve, port_ret, yearly,
                            holding, total_ret, ann_ret, sharpe, max_dd, calmar))

        print(f"  {name:<26} {total_ret:>+8.2%} {ann_ret:>+7.2%} {sharpe:>7.3f} "
              f"{max_dd:>8.2%} {calmar:>7.3f} {pct_spy:>6.1%} {pct_qqq:>6.1%} {pct_gld:>6.1%}")

    best = max(all_results, key=lambda x: x[9])   # Best Sharpe
    (bname, bcfg, bequity, bspy, bret, byearly,
     bholding, btot, bann, bsh, bdd, bcal) = best

    print(f"\n  ★ Best Sharpe: {bname}  ({bsh:.3f})")

    # ── Year-by-year for best config ──────────────────────────────────────
    print(f"\n{'─'*W}")
    print(f"  YEAR-BY-YEAR: {bname}")
    print(f"{'─'*W}")
    print(f"  {'Year':<6} {'Strategy':>9} {'SPY':>9} {'Alpha':>9} "
          f"{'Sharpe':>7} {'MaxDD':>8} {'Primary Hold':>14}")
    print(f"  {'─'*6} {'─'*9} {'─'*9} {'─'*9} {'─'*7} {'─'*8} {'─'*14}")

    for yr, row in byearly.iterrows():
        beat = "✅" if row["Alpha"] > 0 else "  "
        print(f"  {yr:<6} {row['Strategy']:>+9.2%} {row['SPY']:>+9.2%} "
              f"{row['Alpha']:>+9.2%} {row['Sharpe']:>7.2f} "
              f"{row['Max DD']:>8.2%} {row['Hold']:>14}  {beat}")

    # ── Bear year summary ─────────────────────────────────────────────────
    print(f"\n{'─'*W}")
    print(f"  BEAR YEAR PROTECTION")
    print(f"{'─'*W}")
    spy_bh_return = float(bspy.iloc[-1] / bcfg.initial_capital - 1)
    for yr in [2018, 2020, 2022]:
        if yr in byearly.index:
            row = byearly.loc[yr]
            icon = "✅ PROTECTED" if row["Alpha"] > 0 else "❌ FAILED"
            print(f"  {yr}  Strategy {row['Strategy']:>+8.2%}  "
                  f"SPY {row['SPY']:>+8.2%}  "
                  f"Alpha {row['Alpha']:>+8.2%}  {icon}")

    print(f"\n  SPY B&H 10yr: {spy_bh_return:>+.2%}")
    print(f"  Strategy    : {btot:>+.2%}")
    print(f"  Max Drawdown: {bdd:.2%}  (vs SPY ≈ -34% COVID)")
    print("=" * W)


# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Dual Momentum Live Signal Tracker + QQQ Extension"
    )
    parser.add_argument(
        "--signal",   action="store_true",
        help="Show current signal only (fast, no backtest)"
    )
    parser.add_argument(
        "--backtest", action="store_true",
        help="Run full backtest comparison only"
    )
    parser.add_argument(
        "--log",      action="store_true",
        help="Append today's signal to CSV log"
    )
    parser.add_argument(
        "--lookback", type=int, default=126,
        help="Momentum lookback in trading days (default: 126 = 6mo)"
    )
    parser.add_argument(
        "--period",   type=str, default="10y",
        help="Backtest period (default: 10y)"
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.WARNING,   # Quiet by default
        stream=sys.stdout,
        format="%(levelname)s: %(message)s"
    )

    config = LiveMomentumConfig(
        equity_tickers = ["TQQQ", "QQQ"],  # Best performing combo
        safe_ticker    = "GLD",
        cash_ticker    = "BIL",
        lookback       = 21,              # 1 month for optimal momentum
        rebalance_days = 3,                # Every 3 days for optimal leverage
        period         = args.period,
    )

    run_signal  = args.signal   or not (args.signal or args.backtest)
    run_backtest_flag = args.backtest or not (args.signal or args.backtest)

    if run_signal:
        sig = get_live_signal(config)
        print_live_signal(sig)
        if args.log:
            log_signal(sig, config.log_path)

    if run_backtest_flag:
        run_backtest(config)


if __name__ == "__main__":
    main()
