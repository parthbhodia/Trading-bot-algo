"""
app_dual_momentum.py - Interactive Dual Momentum Portfolio Manager

Features:
1. Live momentum dashboard with real-time prices
2. Portfolio allocation calculator
3. Trade execution planner
4. Performance tracking
5. Signal history visualization
"""

import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime, timedelta
import yfinance as yf
from dataclasses import dataclass
from typing import Dict, List, Tuple
import logging

# Import our dual momentum logic
from modules.dual_momentum_live import (
    LiveMomentumConfig,
    _download,
    _download_all,
    _align,
    _momentum,
    _pick_asset,
    get_live_signal,
    print_live_signal
)

logger = logging.getLogger(__name__)

# Page config
st.set_page_config(
    page_title="Dual Momentum Portfolio Manager",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS
st.markdown("""
<style>
.metric-card {
    background-color: #f0f2f6;
    padding: 20px;
    border-radius: 10px;
    margin: 10px 0;
}
.signal-positive { color: #00cc96; }
.signal-negative { color: #ff6692; }
.hold-spy { background-color: #1f77b4; color: white; }
.hold-qqq { background-color: #ff7f0e; color: white; }
.hold-gld { background-color: #d62728; color: white; }
.hold-tlt { background-color: #9467bd; color: white; }
</style>
""", unsafe_allow_html=True)

@dataclass
class PortfolioConfig:
    total_value: float = 100000.0
    max_single_position: float = 0.95  # Max 95% in one asset
    min_cash_buffer: float = 0.05      # Keep 5% cash minimum
    commission_per_trade: float = 5.0  # Fixed commission per trade
    
def calculate_portfolio_allocation(
    current_holdings: Dict[str, float],
    target_allocation: Dict[str, float],
    portfolio_value: float
) -> Dict[str, Dict[str, float]]:
    """
    Calculate trades needed to reach target allocation.
    
    Returns:
        {
            "SPY": {"current": $value, "target": $value, "trade": $value, "shares": #shares},
            ...
        }
    """
    trades = {}
    
    for ticker in target_allocation:
        current_value = current_holdings.get(ticker, 0)
        target_value = portfolio_value * target_allocation[ticker]
        trade_value = target_value - current_value
        
        # Get current price
        price_data = _download(ticker, "5d")
        current_price = price_data.iloc[-1] if len(price_data) > 0 else 100
        
        trades[ticker] = {
            "current": current_value,
            "target": target_value,
            "trade": trade_value,
            "shares": trade_value / current_price,
            "price": current_price
        }
    
    return trades

def create_momentum_chart(data: Dict[str, pd.Series], lookback: int) -> go.Figure:
    """Create a momentum comparison chart."""
    fig = go.Figure()
    
    # Calculate momentum for each asset
    end_date = datetime.now()
    start_date = end_date - timedelta(days=lookback * 2)  # Get extra data for context
    
    colors = {"SPY": "#1f77b4", "QQQ": "#ff7f0e", "GLD": "#d62728", "TLT": "#9467bd"}
    
    for ticker, color in colors.items():
        if ticker in data:
            series = data[ticker]
            # Normalize to 100 at start of lookback
            lookback_start = series.index[-lookback]
            normalized = (series / series.loc[lookback_start]) * 100
            
            fig.add_trace(go.Scatter(
                x=normalized.index,
                y=normalized.values,
                mode='lines',
                name=ticker,
                line=dict(color=color, width=2)
            ))
    
    fig.update_layout(
        title=f"Asset Performance (Last {lookback} Days)",
        xaxis_title="Date",
        yaxis_title="Normalized Value (Start = 100)",
        hovermode='x unified',
        height=400
    )
    
    return fig

def create_allocation_pie(allocation: Dict[str, float]) -> go.Figure:
    """Create a pie chart of current allocation."""
    labels = []
    values = []
    colors = []
    
    color_map = {"SPY": "#1f77b4", "QQQ": "#ff7f0e", "GLD": "#d62728", 
                 "TLT": "#9467bd", "Cash": "#2ca02c"}
    
    for ticker, alloc in allocation.items():
        if alloc > 0.01:  # Only show allocations > 1%
            labels.append(ticker)
            values.append(alloc * 100)
            colors.append(color_map.get(ticker, "#7f7f7f"))
    
    fig = go.Figure(data=[go.Pie(
        labels=labels,
        values=values,
        hole=0.3,
        marker_colors=colors
    )])
    
    fig.update_layout(
        title="Current Allocation",
        height=300
    )
    
    return fig

def main():
    st.title("📊 Dual Momentum Portfolio Manager")
    st.markdown("---")
    
    # Sidebar configuration
    st.sidebar.header("Portfolio Configuration")
    
    portfolio_config = PortfolioConfig(
        total_value=st.sidebar.number_input(
            "Portfolio Value ($)", 
            value=100000.0, 
            min_value=1000.0, 
            step=1000.0
        ),
        max_single_position=st.sidebar.slider(
            "Max Single Position (%)", 
            min_value=50, 
            max_value=100, 
            value=95, 
            step=5
        ) / 100,
        commission_per_trade=st.sidebar.number_input(
            "Commission per Trade ($)", 
            value=5.0, 
            min_value=0.0, 
            step=1.0
        )
    )
    
    # Strategy parameters
    st.sidebar.header("Strategy Parameters")
    lookback = st.sidebar.slider(
        "Momentum Lookback (days)", 
        min_value=21, 
        max_value=252, 
        value=126, 
        step=21
    )
    
    use_qqq = st.sidebar.checkbox("Include QQQ (Tech)", value=True)
    cash_option = st.sidebar.selectbox(
        "Cash/Bond Option", 
        ["TLT", "BIL", "AGG", "Cash"], 
        index=0
    )
    
    # Current holdings input
    st.sidebar.header("Current Holdings")
    tickers = ["SPY", "QQQ", "GLD", "TLT", "Cash"]
    current_holdings = {}
    
    for ticker in tickers:
        if ticker == "Cash":
            current_holdings[ticker] = st.sidebar.number_input(
                f"Cash ($)", 
                value=5000.0, 
                min_value=0.0, 
                step=100.0
            )
        else:
            current_holdings[ticker] = st.sidebar.number_input(
                f"{ticker} ($)", 
                value=0.0, 
                min_value=0.0, 
                step=100.0
            )
    
    # Main content
    # Get live signal
    config = LiveMomentumConfig(
        equity_tickers=["SPY", "QQQ"] if use_qqq else ["SPY"],
        cash_ticker=cash_option if cash_option != "Cash" else "TLT",
        lookback=lookback
    )
    
    with st.spinner("Fetching live data..."):
        signal = get_live_signal(config)
        data = _align(_download_all(config))
    
    # Display current signal
    col1, col2, col3 = st.columns([2, 1, 1])
    
    with col1:
        st.markdown("### Current Signal")
        
        # Signal card
        signal_color = {
            "SPY": "hold-spy", "QQQ": "hold-qqq", 
            "GLD": "hold-gld", "TLT": "hold-tlt", "BIL": "hold-tlt"
        }.get(signal["hold"], "")
        
        st.markdown(f"""
        <div class="metric-card {signal_color}">
            <h2>HOLD: {signal['hold']}</h2>
            <p>Based on {lookback}-day momentum</p>
            <p>Next review: {signal['next_rebal']}</p>
        </div>
        """, unsafe_allow_html=True)
    
    with col2:
        st.markdown("### Momentum Scores")
        for ticker, mom in signal["momenta"].items():
            if not np.isnan(mom):
                color = "signal-positive" if mom > 0 else "signal-negative"
                st.markdown(f"""
                <div class="metric-card">
                    <h4>{ticker}</h4>
                    <p class="{color}">{mom:+.1%}</p>
                </div>
                """, unsafe_allow_html=True)
    
    with col3:
        st.markdown("### Quick Stats")
        qualified_count = len(signal["qualified"])
        st.metric("Qualified Assets", qualified_count)
        st.metric("Lookback", f"{lookback} days")
        st.metric("Signal Date", signal["date"])
    
    # Charts
    st.markdown("---")
    col1, col2 = st.columns([2, 1])
    
    with col1:
        fig = create_momentum_chart(data, lookback)
        st.plotly_chart(fig, use_container_width=True)
    
    with col2:
        # Target allocation
        target_alloc = {signal["hold"]: 1.0}
        if signal["hold"] in ["TLT", "BIL", "AGG"]:
            target_alloc["Cash"] = 1.0
        
        fig = create_allocation_pie(target_alloc)
        st.plotly_chart(fig, use_container_width=True)
    
    # Trade Planner
    st.markdown("---")
    st.markdown("### 📋 Trade Execution Plan")
    
    # Calculate target allocation
    target_allocation = {signal["hold"]: 1.0}
    
    # Calculate trades
    trades = calculate_portfolio_allocation(
        current_holdings,
        target_allocation,
        portfolio_config.total_value
    )
    
    # Display trades table
    trade_df = []
    total_commission = 0
    
    for ticker, trade_info in trades.items():
        if abs(trade_info["trade"]) > 100:  # Only show trades > $100
            action = "BUY" if trade_info["trade"] > 0 else "SELL"
            shares = abs(trade_info["shares"])
            commission = portfolio_config.commission_per_trade if shares > 0 else 0
            total_commission += commission
            
            trade_df.append({
                "Action": action,
                "Ticker": ticker,
                "Shares": f"{shares:.2f}",
                "Price": f"${trade_info['price']:.2f}",
                "Value": f"${abs(trade_info['trade']):,.2f}",
                "Commission": f"${commission:.2f}"
            })
    
    if trade_df:
        df_display = pd.DataFrame(trade_df)
        st.dataframe(df_display, use_container_width=True)
        
        st.markdown(f"""
        **Total Commission: ${total_commission:.2f}**  
        **Total Trade Value: ${sum(abs(t['trade']) for t in trades.values()):,.2f}**
        """)
    else:
        st.info("No trades needed - portfolio is already at target allocation")
    
    # Performance Summary
    st.markdown("---")
    st.markdown("### 📈 Performance Summary")
    
    col1, col2, col3, col4 = st.columns(4)
    
    # Calculate recent performance
    if "SPY" in data:
        spy_1m = _momentum(data["SPY"], 21)
        spy_3m = _momentum(data["SPY"], 63)
        spy_6m = _momentum(data["SPY"], lookback)
        
        with col1:
            st.metric("SPY 1M", f"{spy_1m:+.1%}")
        with col2:
            st.metric("SPY 3M", f"{spy_3m:+.1%}")
        with col3:
            st.metric("SPY 6M", f"{spy_6m:+.1%}")
        with col4:
            st.metric("Volatility (6M)", f"{data['SPY'].pct_change().tail(lookback).std() * np.sqrt(252):.1%}")
    
    # Action buttons
    st.markdown("---")
    col1, col2, col3 = st.columns(3)
    
    with col1:
        if st.button("📥 Export Trade Plan", type="primary"):
            # Create CSV of trades
            if trade_df:
                csv = pd.DataFrame(trade_df).to_csv(index=False)
                st.download_button(
                    label="Download CSV",
                    data=csv,
                    file_name=f"trades_{signal['date']}.csv",
                    mime="text/csv"
                )
    
    with col2:
        if st.button("🔄 Refresh Data"):
            st.rerun()
    
    with col3:
        if st.button("📊 View Backtest"):
            st.info("Backtest feature coming soon! Check dual_momentum_live.py for detailed backtests.")
    
    # Footer
    st.markdown("---")
    st.markdown("""
    **Important Notes:**
    - Review signals on the first trading day of each month
    - This strategy uses 6-month momentum (126 days) by default
    - Past performance does not guarantee future results
    - Consider tax implications of frequent trading
    - Always maintain adequate cash buffer for emergencies
    """)

if __name__ == "__main__":
    main()
