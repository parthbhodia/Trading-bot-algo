import { API_BASE_URL } from "../../config.js";
import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, Area, AreaChart, ComposedChart } from 'recharts';
import Toast from '../Toast';
import HMAKahlmanChart from './HMAKahlmanChart';
import TradingToolbar from './TradingToolbar';

const BacktestChart = () => {
  const [backtestData, setBacktestData] = useState([]);
  const [backtestMetrics, setBacktestMetrics] = useState(null);
  const [availableStrategies, setAvailableStrategies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedStrategy, setSelectedStrategy] = useState('hmaKahlman3Confirm');
  const [selectedSymbol, setSelectedSymbol] = useState('PLTR');
  const [selectedPeriod, setSelectedPeriod] = useState('3y');
  const [selectedInterval, setSelectedInterval] = useState('1d');
  const [hiddenLines, setHiddenLines] = useState({});
  const [toast, setToast] = useState(null);
  const [lastSignalIndex, setLastSignalIndex] = useState(-1);
  const [portfolioIndicators, setPortfolioIndicators] = useState({
    rsi: false,
    macd: false,
    bollinger: false,
    volume: false,
    stochastic: false,
    atr: false,
  });

  // ── Live signal state (real per-confirmation values) ────────────────────
  const [liveSignal, setLiveSignal] = useState(null);
  const [liveSignalLoading, setLiveSignalLoading] = useState(false);
  const [liveSignalLastChecked, setLiveSignalLastChecked] = useState(null);
  const [prevLiveSignalValue, setPrevLiveSignalValue] = useState(null);
  const [notifPermission, setNotifPermission] = useState('default');
  const [audioAlertsEnabled, setAudioAlertsEnabled] = useState(false);
  const [showNotifHelp, setShowNotifHelp] = useState(false);

  // Sync notification permission state on mount (don't auto-request — let user click)
  useEffect(() => {
    if ('Notification' in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  // ── Audio beep alert (works without any browser permission) ──────────────
  const playAlertBeep = (isBuy) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      // BUY = two rising tones, SELL = two falling tones
      osc.frequency.setValueAtTime(isBuy ? 660 : 880, ctx.currentTime);
      osc.frequency.setValueAtTime(isBuy ? 880 : 550, ctx.currentTime + 0.15);
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.warn('Audio alert unavailable:', e);
    }
  };

  // Handle "Enable Alerts" button click
  const handleEnableAlerts = async () => {
    if (!('Notification' in window)) {
      setAudioAlertsEnabled(true); // fallback: audio only
      setToast({ message: '🔔 Audio alerts enabled (browser notifications not supported)', type: 'success', duration: 4000 });
      return;
    }
    const current = Notification.permission;
    if (current === 'denied') {
      setShowNotifHelp(true);
      setAudioAlertsEnabled(true); // still enable audio
      return;
    }
    if (current === 'granted') {
      setNotifPermission('granted');
      return;
    }
    // 'default' — request permission
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
    if (perm === 'granted') {
      setAudioAlertsEnabled(true);
      setToast({ message: '🔔 Alerts enabled! You will be notified on BUY/SELL signals.', type: 'success', duration: 4000 });
      // Test beep
      playAlertBeep(true);
    } else if (perm === 'denied') {
      setShowNotifHelp(true);
      setAudioAlertsEnabled(true);
      setToast({ message: '🔔 Browser notifications blocked — audio alerts enabled instead', type: 'warning', duration: 5000 });
    }
  };

  // Fetch live signal whenever symbol / interval changes
  useEffect(() => {
    fetchLiveSignal();
    const interval = setInterval(fetchLiveSignal, 5 * 60 * 1000); // every 5 min
    return () => clearInterval(interval);
  }, [selectedSymbol, selectedInterval]);

  const fetchLiveSignal = async () => {
    try {
      setLiveSignalLoading(true);
      const res = await fetch(
        `${API_BASE_URL}/api/pltr-signal?symbol=${selectedSymbol}&interval=${selectedInterval}`
      );
      if (!res.ok) throw new Error(`Signal API returned ${res.status}`);
      const data = await res.json();
      setLiveSignal(data);
      setLiveSignalLastChecked(new Date());

      // Browser notification + audio beep + toast on signal change
      const newSig = data.signal;
      if (prevLiveSignalValue && prevLiveSignalValue !== newSig && newSig !== 'HOLD') {
        const isB = newSig === 'BUY';
        const msg = `${selectedSymbol} ${newSig} Signal! $${data.price} | ${data.confirm_count}/3 confirmations`;
        // Browser push notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`${isB ? '🟢' : '🔴'} ${selectedSymbol} ${newSig}`, {
            body: msg,
            icon: '/favicon.ico',
          });
        }
        // Audio beep (always fires if enabled, no permission needed)
        if (audioAlertsEnabled) playAlertBeep(isB);
        setToast({ message: msg, type: isB ? 'success' : 'warning', duration: 8000 });
      }
      setPrevLiveSignalValue(newSig);
    } catch (e) {
      console.error('Live signal fetch failed:', e);
    } finally {
      setLiveSignalLoading(false);
    }
  };

  useEffect(() => {
    // Fetch available strategies
    fetchAvailableStrategies();
  }, []);

  // Reset period to a compatible value when interval changes
  useEffect(() => {
    if (selectedInterval === '1h' && !['1mo','3mo','6mo','1y','2y'].includes(selectedPeriod)) {
      setSelectedPeriod('1y');
    } else if (selectedInterval === '1wk' && selectedPeriod === '1mo') {
      setSelectedPeriod('1y');
    }
  }, [selectedInterval]);

  useEffect(() => {
    if (selectedStrategy && selectedSymbol) {
      fetchBacktestData();
    }
  }, [selectedStrategy, selectedSymbol, selectedPeriod, selectedInterval]);

  const fetchAvailableStrategies = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/strategies`);
      const data = await response.json();
      setAvailableStrategies(data.strategies);
      
      // Set default strategy to first available
      if (data.strategies.length > 0 && !selectedStrategy) {
        setSelectedStrategy(data.strategies[0].id);
      }
    } catch (error) {
      console.error('Error fetching strategies:', error);
      setError('Failed to fetch strategies');
    }
  };

  const fetchBacktestData = async () => {
    try {
      setIsLoading(true);
      
      const response = await fetch('${API_BASE_URL}/api/backtest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: selectedSymbol,
          strategy: selectedStrategy,
          period: selectedPeriod,
          interval: selectedInterval,
          initial_capital: 100000
        })
      });
      
      const data = await response.json();

      // Store API metrics directly — avoids incorrect recalculation on frontend
      setBacktestMetrics({
        totalReturn: data.total_return ?? 0,
        annualizedReturn: data.annualized_return ?? 0,
        maxDrawdown: data.max_drawdown ?? 0,
        sharpeRatio: data.sharpe_ratio ?? 0,
        winRate: data.win_rate ?? 0,
        totalTrades: data.total_trades ?? 0,
        buyAndHoldReturn: data.buy_and_hold_return ?? 0,
        buyAndHoldMaxDrawdown: data.buy_and_hold_max_drawdown ?? 0,
        drawdownAlpha: data.drawdown_alpha ?? 0,
      });

      // Format data for charts
      const formattedData = data.equity_curve && data.equity_curve.length > 0
        ? data.equity_curve.map(item => ({
            date: item.date,
            ticker_price: item.ticker_price || 100,
            portfolio: item.portfolio_value,
            buy_and_hold_value: item.buy_and_hold_value || null,
            signal: item.signal || 'HOLD',
            position: 1,
            drawdown: item.drawdown || 0,
            // OHLC data for candlestick chart
            open: item.open || item.ticker_price,
            high: item.high || item.ticker_price,
            low: item.low || item.ticker_price,
            close: item.close || item.ticker_price
          }))
        : [{
            date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            ticker_price: 100,
            portfolio: 100000,
            signal: 'HOLD',
            position: 0,
            drawdown: 0
          }];

      setBacktestData(formattedData);
      setError(null);

      // Show toast notification for latest signal if it changed
      if (formattedData.length > 0) {
        const latestIndex = formattedData.length - 1;
        const latestSignal = formattedData[latestIndex]?.signal;

        if (latestSignal && latestSignal !== 'HOLD' && lastSignalIndex !== latestIndex) {
          const signalType = latestSignal === 'BUY' ? 'success' : 'warning';
          const signalMessage = latestSignal === 'BUY'
            ? `🚀 ${selectedSymbol} - BUY SIGNAL at $${formattedData[latestIndex].ticker_price.toFixed(2)}`
            : `⚠️ ${selectedSymbol} - SELL SIGNAL at $${formattedData[latestIndex].ticker_price.toFixed(2)}`;

          setToast({
            message: signalMessage,
            type: signalType,
            duration: 5000
          });
          setLastSignalIndex(latestIndex);
        }
      }
    } catch (error) {
      console.error('Error fetching backtest data:', error);
      setError('Failed to fetch backtest data');
    } finally {
      setIsLoading(false);
    }
  };

  const getSignalColor = (signal) => {
    switch (signal) {
      case 'BUY': return '#10b981';
      case 'SELL': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getMetrics = () => backtestMetrics ?? {
    totalReturn: 0,
    annualizedReturn: 0,
    maxDrawdown: 0,
    sharpeRatio: 0,
    winRate: 0,
    totalTrades: 0,
    buyAndHoldReturn: 0,
    buyAndHoldMaxDrawdown: 0,
    drawdownAlpha: 0,
  };

  const getStrategyInfo = (strategyId) => {
    const strategy = availableStrategies.find(s => s.id === strategyId);
    return strategy || { name: strategyId, description: 'Strategy not found' };
  };

  // Calculate WMA helper
  const calcWMA = (values, period) => {
    const result = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let num = 0, den = 0;
      for (let j = 0; j < period; j++) {
        const w = period - j;
        num += (values[i - j] ?? 0) * w;
        den += w;
      }
      result[i] = den ? num / den : null;
    }
    return result;
  };

  // HMA-Kahlman for portfolio performance chart
  const calcHMAK = (values, period, gain) => {
    const half = Math.round(period / 2);
    const sqrtp = Math.round(Math.sqrt(period));
    const wh = calcWMA(values, half);
    const wf = calcWMA(values, period);
    const raw = values.map((_, i) => (wh[i] != null && wf[i] != null) ? 2 * wh[i] - wf[i] : null);
    const firstValid = raw.findIndex(v => v != null);
    if (firstValid === -1) return values.map(() => null);
    const wmaResult = calcWMA(raw.slice(firstValid), sqrtp);
    const hmaValues = [...new Array(firstValid).fill(null), ...wmaResult];
    // Kahlman
    let kf = null, vel = 0;
    return hmaValues.map(v => {
      if (v == null) return null;
      if (kf == null) { kf = v; return v; }
      const dist = v - kf;
      const err = dist * Math.sqrt(gain * 2);
      vel = vel + gain * dist;
      kf = kf + err + vel;
      return kf;
    });
  };

  // Add HMA-Kahlman to portfolio chart data
  const dataWithEMA = (() => {
    if (!backtestData.length) return backtestData;
    const portfolioValues = backtestData.map(d => d.portfolio);
    const hmaFast = calcHMAK(portfolioValues, 7, 0.7);
    const hmaSlow = calcHMAK(portfolioValues, 14, 0.7);
    return backtestData.map((d, i) => ({
      ...d,
      ema7: hmaFast[i],
      ema14: hmaSlow[i],
    }));
  })();

  const handleLegendClick = (e) => {
    const key = e.dataKey;
    setHiddenLines(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (isLoading) {
    return (
      <div className="h-64 flex items-center justify-center text-zinc-400">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mx-auto mb-4"></div>
          <p>Loading backtest data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-64 flex items-center justify-center text-zinc-400">
        <div className="text-center">
          <p className="text-red-400">{error}</p>
          <p className="text-sm mt-2">Using fallback data</p>
        </div>
      </div>
    );
  }

  const metrics = getMetrics();

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => setToast(null)}
        />
      )}
      {/* Strategy Selector */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-white">Trading Strategy Backtest</h3>
          <p className="text-zinc-400 text-sm">{getStrategyInfo(selectedStrategy).description}</p>
        </div>
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <label className="text-zinc-400 text-sm">Symbol:</label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-zinc-800 text-white px-3 py-2 rounded border border-zinc-700 focus:border-green-400 focus:outline-none"
            >
              <optgroup label="AI / Tech">
                <option value="PLTR">PLTR (Palantir)</option>
                <option value="NVDA">NVDA (Nvidia)</option>
                <option value="MSFT">MSFT (Microsoft)</option>
                <option value="ORCL">ORCL (Oracle)</option>
                <option value="AVGO">AVGO (Broadcom)</option>
                <option value="POET">POET (POET Technologies)</option>
              </optgroup>
              <optgroup label="ETFs">
                <option value="TQQQ">TQQQ (3x Nasdaq)</option>
                <option value="QQQ">QQQ (Nasdaq)</option>
                <option value="SPY">SPY (S&P 500)</option>
              </optgroup>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <label className="text-zinc-400 text-sm">Interval:</label>
            <select
              value={selectedInterval}
              onChange={(e) => setSelectedInterval(e.target.value)}
              className="bg-zinc-800 text-white px-3 py-2 rounded border border-zinc-700 focus:border-green-400 focus:outline-none"
            >
              <option value="1wk">Weekly (1W)</option>
              <option value="1d">Daily (1D)</option>
              <option value="1h">Hourly (1H) — max 2yr</option>
            </select>
          </div>
          
          <div className="flex items-center space-x-2">
            <label className="text-zinc-400 text-sm">Strategy:</label>
            <select
              value={selectedStrategy}
              onChange={(e) => setSelectedStrategy(e.target.value)}
              className="bg-zinc-800 text-white px-3 py-2 rounded border border-zinc-700 focus:border-green-400 focus:outline-none"
            >
              {availableStrategies.map(strategy => (
                <option key={strategy.id} value={strategy.id}>
                  {strategy.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <label className="text-zinc-400 text-sm">Period:</label>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="bg-zinc-800 text-white px-3 py-2 rounded border border-zinc-700 focus:border-green-400 focus:outline-none"
            >
              {selectedInterval === '1h' ? (
                <>
                  <option value="1mo">1 Month</option>
                  <option value="3mo">3 Months</option>
                  <option value="6mo">6 Months</option>
                  <option value="1y">1 Year</option>
                  <option value="2y">2 Years (max)</option>
                </>
              ) : selectedInterval === '1wk' ? (
                <>
                  <option value="1mo">1 Month</option>
                  <option value="3mo">3 Months</option>
                  <option value="6mo">6 Months</option>
                  <option value="1y">1 Year</option>
                  <option value="3y">3 Years</option>
                  <option value="5y">5 Years</option>
                  <option value="10y">10 Years</option>
                  <option value="max">Max History</option>
                </>
              ) : (
                <>
                  <option value="1mo">1 Month</option>
                  <option value="3mo">3 Months</option>
                  <option value="6mo">6 Months</option>
                  <option value="1y">1 Year</option>
                  <option value="3y">3 Years</option>
                  <option value="5y">5 Years</option>
                  <option value="10y">10 Years</option>
                </>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="glass p-3 rounded">
          <p className="text-zinc-400 text-xs">Total Return</p>
          <p className={`font-semibold ${metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {metrics.totalReturn.toFixed(2)}%
          </p>
        </div>
        <div className="glass p-3 rounded">
          <p className="text-zinc-400 text-xs">Max Drawdown</p>
          <p className="text-red-400 font-semibold">{metrics.maxDrawdown.toFixed(2)}%</p>
        </div>
        <div className="glass p-3 rounded">
          <p className="text-zinc-400 text-xs">Sharpe Ratio</p>
          <p className="text-white font-semibold">{metrics.sharpeRatio.toFixed(2)}</p>
        </div>
        <div className="glass p-3 rounded">
          <p className="text-zinc-400 text-xs">Win Rate</p>
          <p className="text-white font-semibold">{metrics.winRate.toFixed(1)}%</p>
        </div>
        <div className="glass p-3 rounded">
          <p className="text-zinc-400 text-xs">Total Trades</p>
          <p className="text-white font-semibold">{metrics.totalTrades}</p>
        </div>
        <div className="glass p-3 rounded">
          <p className="text-zinc-400 text-xs">Annualized</p>
          <p className={`font-semibold ${metrics.annualizedReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {metrics.annualizedReturn.toFixed(2)}%
          </p>
        </div>
        {/* Buy & Hold card — return + max drawdown */}
        <div className="glass p-3 rounded border border-zinc-600/40 col-span-1">
          <p className="text-zinc-400 text-xs">B&amp;H {selectedSymbol}</p>
          <p className={`font-semibold ${metrics.buyAndHoldReturn >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
            {metrics.buyAndHoldReturn.toFixed(1)}%
          </p>
          <p className="text-zinc-500 text-xs mt-0.5">
            DD: <span className="text-red-400">{metrics.buyAndHoldMaxDrawdown.toFixed(1)}%</span>
          </p>
        </div>

        {/* Alpha return card */}
        <div className={`glass p-3 rounded border ${(metrics.totalReturn - metrics.buyAndHoldReturn) >= 0 ? 'border-green-500/30' : 'border-red-500/30'}`}>
          <p className="text-zinc-400 text-xs">Return Alpha</p>
          <p className={`font-semibold ${(metrics.totalReturn - metrics.buyAndHoldReturn) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {(metrics.totalReturn - metrics.buyAndHoldReturn) >= 0 ? '+' : ''}{(metrics.totalReturn - metrics.buyAndHoldReturn).toFixed(1)}%
          </p>
          <p className="text-zinc-500 text-xs mt-0.5">vs buy &amp; hold</p>
        </div>

        {/* Drawdown alpha card — positive = strategy protected more */}
        <div className={`glass p-3 rounded border ${metrics.drawdownAlpha >= 0 ? 'border-green-500/30' : 'border-red-500/30'}`}>
          <p className="text-zinc-400 text-xs">DD Alpha</p>
          <p className={`font-semibold ${metrics.drawdownAlpha >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {metrics.drawdownAlpha >= 0 ? '+' : ''}{metrics.drawdownAlpha.toFixed(1)}%
          </p>
          <p className="text-zinc-500 text-xs mt-0.5">{metrics.drawdownAlpha >= 0 ? 'less risk' : 'more risk'} vs B&amp;H</p>
        </div>
      </div>

      {/* ── Live Signal Panel (real per-confirmation values from /api/pltr-signal) ── */}
      {(() => {
        const intervalLabel = selectedInterval === '1wk' ? 'Weekly' : selectedInterval === '1h' ? 'Hourly' : 'Daily';
        const ls  = liveSignal;
        const sig = ls?.signal ?? '...';
        const sigColor = sig === 'BUY' ? 'text-green-400' : sig === 'SELL' ? 'text-red-400' : 'text-yellow-400';
        const sigBg    = sig === 'BUY' ? 'bg-green-500/20 border-green-500/40' : sig === 'SELL' ? 'bg-red-500/20 border-red-500/40' : 'bg-yellow-500/20 border-yellow-500/40';

        const confirms = ls ? [
          {
            label: 'HMA-K Crossover',
            desc:  ls.fast_k > ls.slow_k
                     ? `Fast ${ls.fast_k?.toFixed(2)} > Slow ${ls.slow_k?.toFixed(2)}`
                     : `Fast ${ls.fast_k?.toFixed(2)} < Slow ${ls.slow_k?.toFixed(2)}`,
            active: ls.confirmations?.hma_cross,
          },
          {
            label: '200 EMA Trend',
            desc:  ls.price > ls.ema200
                     ? `Price $${ls.price} > EMA $${ls.ema200?.toFixed(2)}`
                     : `Price $${ls.price} < EMA $${ls.ema200?.toFixed(2)}`,
            active: ls.confirmations?.above_ema200,
          },
          {
            label: 'Volume Surge',
            desc:  ls.volume > 0
                     ? `${ls.volume_ratio}x avg (${(ls.volume / 1e6).toFixed(1)}M vs ${(ls.volume_sma20 / 1e6).toFixed(1)}M avg)`
                     : 'No volume data',
            active: ls.confirmations?.volume_ok,
          },
        ] : [
          { label: 'HMA-K Crossover', desc: 'Loading...', active: null },
          { label: '200 EMA Trend',   desc: 'Loading...', active: null },
          { label: 'Volume Surge',    desc: 'Loading...', active: null },
        ];

        const timeAgo = liveSignalLastChecked
          ? (() => {
              const s = Math.floor((Date.now() - liveSignalLastChecked) / 1000);
              return s < 60 ? 'just now' : `${Math.floor(s / 60)}m ago`;
            })()
          : 'never';

        return (
          <div className="glass p-4 rounded border border-zinc-700/50">
            {/* Header row */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="text-white font-semibold text-sm">
                  Live Signal — {selectedSymbol} ({intervalLabel})
                </h4>
                <p className="text-zinc-500 text-xs mt-0.5">
                  All 3 must confirm for BUY · SELL on crossover reversal · Updated: {timeAgo}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {/* ── Alert controls ── */}
                {notifPermission === 'granted' && audioAlertsEnabled ? (
                  /* Both enabled */
                  <span className="text-xs text-green-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse inline-block"></span>
                    Alerts ON
                  </span>
                ) : notifPermission === 'denied' ? (
                  /* Browser blocked — show audio toggle + help */
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setAudioAlertsEnabled(a => !a); setShowNotifHelp(false); }}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${audioAlertsEnabled ? 'border-green-500 text-green-400' : 'border-zinc-600 text-zinc-400 hover:border-yellow-500 hover:text-yellow-400'}`}
                      title="Toggle audio beep alerts (no browser permission needed)"
                    >
                      {audioAlertsEnabled ? '🔊 Audio ON' : '🔇 Audio OFF'}
                    </button>
                    <button
                      onClick={() => setShowNotifHelp(h => !h)}
                      className="text-xs text-red-400 border border-red-500/40 px-2 py-1 rounded hover:border-red-400 transition-colors"
                      title="Notifications are blocked by your browser"
                    >
                      🚫 Notif Blocked
                    </button>
                  </div>
                ) : (
                  /* Default / not yet asked */
                  <button
                    onClick={handleEnableAlerts}
                    className="text-xs text-zinc-400 border border-zinc-600 px-2 py-1 rounded hover:border-green-500 hover:text-green-400 transition-colors"
                    title="Enable desktop alerts for signal changes"
                  >
                    🔔 Enable Alerts
                  </button>
                )}
                {/* Refresh button */}
                <button
                  onClick={fetchLiveSignal}
                  disabled={liveSignalLoading}
                  className="text-xs text-zinc-400 border border-zinc-600 px-2 py-1 rounded hover:border-zinc-400 transition-colors disabled:opacity-50"
                >
                  {liveSignalLoading ? '...' : 'Refresh'}
                </button>
                {/* Current signal badge */}
                <div className={`px-4 py-1.5 rounded-full border font-bold text-base ${sigBg} ${sigColor}`}>
                  {liveSignalLoading ? '...' : sig}
                  {ls && <span className="text-xs font-normal ml-1 opacity-80">${ls.price}</span>}
                </div>
              </div>
            </div>

            {/* Notifications blocked — help banner */}
            {showNotifHelp && (
              <div className="mb-3 p-2.5 rounded bg-yellow-500/10 border border-yellow-500/30 flex items-start justify-between gap-3">
                <div>
                  <p className="text-yellow-400 text-xs font-semibold mb-1">Browser notifications are blocked</p>
                  <p className="text-zinc-400 text-xs">
                    To re-enable: click the 🔒 lock icon in your browser address bar → Site settings → Notifications → Allow.
                    Audio alerts are active as fallback (🔊 icon above).
                  </p>
                </div>
                <button onClick={() => setShowNotifHelp(false)} className="text-zinc-500 hover:text-white text-xs shrink-0">✕</button>
              </div>
            )}

            {/* Confirmation cards */}
            <div className="grid grid-cols-3 gap-3 mb-3">
              {confirms.map((c, idx) => (
                <div key={idx} className={`rounded-lg p-3 border transition-colors ${
                  c.active === null  ? 'bg-zinc-800/40 border-zinc-700/40' :
                  c.active           ? 'bg-green-500/10 border-green-500/30' :
                                       'bg-red-500/10 border-red-500/20'
                }`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      c.active === null ? 'bg-zinc-700 text-zinc-400' :
                      c.active         ? 'bg-green-500 text-white' :
                                         'bg-red-500/60 text-white'
                    }`}>
                      {c.active === null ? '?' : c.active ? '✓' : '✗'}
                    </span>
                    <span className={`text-xs font-semibold ${
                      c.active === null ? 'text-zinc-400' :
                      c.active         ? 'text-green-400' :
                                         'text-red-400'
                    }`}>{c.label}</span>
                  </div>
                  <p className="text-zinc-500 text-xs leading-tight">{c.desc}</p>
                </div>
              ))}
            </div>

            {/* Confirm count + backtest summary */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {ls && [0,1,2].map(i => (
                  <span key={i} className={`w-2 h-2 rounded-full ${i < ls.confirm_count ? 'bg-green-400' : 'bg-zinc-600'}`} />
                ))}
                {ls && (
                  <span className="text-xs text-zinc-400 ml-1">
                    {ls.confirm_count}/3 confirmed
                    {ls.confirm_count === 3 && ' — all green, enter long'}
                    {ls.confirm_count === 2 && ' — wait for 3rd'}
                    {ls.confirm_count <= 1 && ' — stay out'}
                  </span>
                )}
              </div>
              {selectedStrategy === 'hmaKahlman3Confirm' && (
                <p className="text-zinc-600 text-xs">
                  Backtest: {metrics.totalTrades} trades · Ann. {metrics.annualizedReturn.toFixed(1)}%
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* HMA-Kahlman Price Chart */}
      <div className="glass p-4 rounded">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-white font-semibold">
            {selectedSymbol} · Price Action &amp; HMA-Kahlman Trend
            <span className="text-zinc-500 text-xs font-normal ml-2">
              ({selectedInterval === '1wk' ? 'Weekly' : selectedInterval === '1h' ? 'Hourly' : 'Daily'} candles)
            </span>
          </h4>
          <span className="text-xs text-zinc-500">Powered by TradingView Lightweight Charts</span>
        </div>
        <HMAKahlmanChart data={backtestData} symbol={selectedSymbol} />
      </div>

      {/* Equity Curve & Backtest Chart */}
      <div className="glass p-4 rounded">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-white font-semibold">Portfolio Performance</h4>
          <TradingToolbar
            indicators={portfolioIndicators}
            onToggleIndicator={(id) => setPortfolioIndicators(prev => ({
              ...prev,
              [id]: !prev[id]
            }))}
          />
        </div>
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={dataWithEMA}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis 
            dataKey="date" 
            stroke="#9ca3af"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
          />
          <YAxis 
            yAxisId="price"
            stroke="#9ca3af"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
          />
          <YAxis 
            yAxisId="drawdown"
            orientation="right"
            stroke="#9ca3af"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            tickFormatter={(value) => `${value.toFixed(0)}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px'
            }}
            labelStyle={{ color: '#f3f4f6' }}
            formatter={(value, name) => {
              if (name === 'drawdown') return [`${value.toFixed(2)}%`, 'Drawdown'];
              if (name === 'portfolio') return [`$${value.toLocaleString()}`, 'Portfolio'];
              if (name === 'ticker_price') return [`$${value.toFixed(2)}`, `${selectedSymbol || 'Asset'} Price`];
              return [value, name];
            }}
          />
          <Legend
            wrapperStyle={{ color: '#f3f4f6', cursor: 'pointer' }}
            iconType="line"
            onClick={handleLegendClick}
          />
          
          {/* Equity Asset Price */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="ticker_price"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={false}
            name={`${selectedSymbol} Price`}
            hide={!!hiddenLines['ticker_price']}
          />

          {/* Portfolio Value */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="portfolio"
            stroke="#10b981"
            strokeWidth={3}
            dot={false}
            name="Portfolio Value"
            hide={!!hiddenLines['portfolio']}
          />

          {/* HMA-Kahlman Trend Lines */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="ema7"
            stroke="#10b981"
            strokeWidth={2}
            strokeDasharray="0"
            dot={false}
            name="HMA-K Fast (7)"
            hide={!!hiddenLines['ema7']}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="ema14"
            stroke="#f472b6"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            name="HMA-K Slow (14)"
            hide={!!hiddenLines['ema14']}
          />

          {/* Drawdown */}
          <Area
            yAxisId="drawdown"
            type="monotone"
            dataKey="drawdown"
            stroke="#ef4444"
            fill="#ef4444"
            fillOpacity={0.3}
            strokeWidth={1}
            name="Drawdown"
            hide={!!hiddenLines['drawdown']}
          />

          {/* Buy & Hold benchmark line */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="buy_and_hold_value"
            stroke="#3b82f6"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            dot={false}
            name="Buy & Hold"
            hide={!!hiddenLines['buy_and_hold_value']}
          />

          {/* BUY / SELL signal lines — vertical ReferenceLine spans full chart height */}
          {(() => {
            const lines = [];
            let prevSig = 'HOLD';
            for (const d of dataWithEMA) {
              if (d.signal !== 'HOLD' && d.signal !== prevSig) {
                lines.push(d);
                prevSig = d.signal;
              }
            }
            return lines.map((d, i) => {
              const isBuy = d.signal === 'BUY';
              return (
                <ReferenceLine
                  key={`sig-${i}-${d.date}`}
                  x={d.date}
                  yAxisId="price"
                  stroke={isBuy ? '#10b981' : '#ef4444'}
                  strokeWidth={1.5}
                  strokeDasharray={isBuy ? '0' : '4 3'}
                  strokeOpacity={0.85}
                  label={{
                    value: isBuy ? '▲' : '▼',
                    position: isBuy ? 'insideBottomRight' : 'insideTopRight',
                    fill: isBuy ? '#10b981' : '#ef4444',
                    fontSize: 11,
                    fontWeight: 'bold',
                  }}
                />
              );
            });
          })()}
        </ComposedChart>
      </ResponsiveContainer>
      </div>

      {/* Trade History - Shows actual BUY/SELL transitions */}
      <div className="space-y-2">
        <h4 className="text-white font-semibold">Trade History</h4>
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-xs text-zinc-300">
            <thead className="sticky top-0 bg-zinc-900">
              <tr className="border-b border-zinc-700">
                <th className="text-left py-2 px-3 text-zinc-400">Date</th>
                <th className="text-left py-2 px-3 text-zinc-400">Signal</th>
                <th className="text-right py-2 px-3 text-zinc-400">Price</th>
                <th className="text-right py-2 px-3 text-zinc-400">Portfolio</th>
                <th className="text-right py-2 px-3 text-zinc-400">Drawdown</th>
                <th className="text-right py-2 px-3 text-zinc-400">Trade P/L</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Extract actual signal changes (BUY→SELL or SELL→BUY transitions)
                const trades = [];
                let prevSignal = null;
                for (let i = 0; i < backtestData.length; i++) {
                  const d = backtestData[i];
                  if (d.signal !== 'HOLD' && d.signal !== prevSignal) {
                    trades.push(d);
                    prevSignal = d.signal;
                  }
                }
                // Show last 20 trade transitions, newest first
                return trades.slice(-20).reverse().map((trade, index, arr) => {
                  // Calculate P/L for SELL signals by finding the preceding BUY
                  let tradePL = null;
                  if (trade.signal === 'SELL') {
                    // Find the next item in reversed array (which is the previous BUY chronologically)
                    const buyTrade = arr.slice(index + 1).find(t => t.signal === 'BUY');
                    if (buyTrade) {
                      tradePL = ((trade.ticker_price - buyTrade.ticker_price) / buyTrade.ticker_price) * 100;
                    }
                  }
                  return (
                    <tr key={index} className="border-b border-zinc-800 hover:bg-zinc-800/30">
                      <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">{trade.date}</td>
                      <td className="py-2 px-3">
                        <span className={`font-semibold ${getSignalColor(trade.signal)}`}>
                          {trade.signal === 'BUY' ? '📈 BUY' : '📉 SELL'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-white whitespace-nowrap">
                        ${trade.ticker_price.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right text-green-400 font-semibold whitespace-nowrap">
                        ${trade.portfolio ? Math.round(trade.portfolio).toLocaleString() : '—'}
                      </td>
                      <td className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${trade.drawdown > 20 ? 'text-red-400' : 'text-orange-400'}`}>
                        {trade.drawdown?.toFixed(1)}%
                      </td>
                      <td className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${
                        tradePL === null ? 'text-zinc-500' : tradePL >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {tradePL !== null ? `${tradePL >= 0 ? '+' : ''}${tradePL.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          💡 Shows actual BUY↔SELL transitions. Trade P/L shows the price change between each BUY→SELL pair.
        </p>
      </div>
    </div>
  );
};

export default BacktestChart;
