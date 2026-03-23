"""
TQQQ Terminal Strategy - Separate from original dual momentum
Uses the exact same calculation as terminal but kept completely separate
"""

import sys
import os
import pandas as pd
import numpy as np
from typing import Dict, Tuple
import yfinance as yf

# Add stock-predictor path to import original functions
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'stock-predictor'))

try:
    from modules.dual_momentum_live import (
        LiveMomentumConfig, 
        _download_all, 
        _align, 
        _run_backtest
    )
except ImportError as e:
    print(f"[FAIL] Failed to import from stock-predictor: {e}")
    # Try alternative import
    try:
        from modules.dual_momentum_live import (
            LiveMomentumConfig, 
            _download_all, 
            _align, 
            _run_backtest
        )
    except ImportError as e2:
        print(f"[FAIL] Alternative import failed: {e2}")
        raise ImportError(f"Cannot import dual_momentum_live: {e2}")

class TQQQTerminalStrategy:
    """TQQQ strategy that uses terminal calculations but keeps original algorithm separate"""
    
    def __init__(self, period: str = "10y"):
        """Initialize TQQQ strategy with terminal-proven parameters"""
        self.config = LiveMomentumConfig(
            equity_tickers = ["TQQQ", "QQQ"],
            safe_ticker    = "GLD", 
            cash_ticker    = "BIL",
            lookback       = 21,
            rebalance_days = 3,
            period         = period,
            initial_capital = 100_000.0  # FIX: Use $100k like dashboard expects
        )
    
    def run_backtest(self) -> Tuple[pd.Series, pd.Series, pd.Series, pd.DataFrame, pd.Series]:
        """Run backtest using exact terminal calculation"""
        print(f"  Downloading {self.config.period} of data for {self.config.equity_tickers + [self.config.safe_ticker, self.config.cash_ticker]}...")
        
        # Use exact same data download as terminal
        data = _align(_download_all(self.config))
        
        # DEBUG: Print data info
        print(f"  Data points: {len(list(data.values())[0])} from {list(data.values())[0].index[0]} to {list(data.values())[0].index[-1]}")
        
        # Use exact same backtest calculation as terminal
        equity, spy_curve, port_ret, yearly_df, holding = _run_backtest(data, self.config)
        
        # DEBUG: Print calculation results
        print(f"  Initial Capital: ${self.config.initial_capital:,.0f}")
        print(f"  Final Equity: ${equity.iloc[-1]:,.0f}")
        print(f"  Total Return: {equity.iloc[-1] / self.config.initial_capital - 1:.2%}")
        print(f"  Data Period: {equity.index[0]} to {equity.index[-1]}")
        
        return equity, spy_curve, port_ret, yearly_df, holding
    
    def get_live_signal(self) -> dict:
        """Get live signal using terminal calculation"""
        from modules.dual_momentum_live import get_live_signal
        return get_live_signal(self.config)

def run_tqqq_backtest(period: str = "10y") -> Tuple[pd.Series, pd.Series, pd.Series, pd.DataFrame, pd.Series]:
    """Convenience function to run TQQQ backtest"""
    # Map dashboard periods to terminal periods
    period_mapping = {
        "6m": "6mo",
        "1y": "1y", 
        "3y": "3y",
        "5y": "5y",
        "10y": "10y",
        "MAX": "max"
    }
    terminal_period = period_mapping.get(period, period)
    strategy = TQQQTerminalStrategy(terminal_period)
    return strategy.run_backtest()

def get_tqqq_signal() -> dict:
    """Convenience function to get TQQQ live signal"""
    strategy = TQQQTerminalStrategy()
    return strategy.get_live_signal()
