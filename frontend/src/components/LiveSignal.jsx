import React, { useState, useEffect } from 'react';
import { AlertCircle, TrendingUp, Shield, DollarSign, Info, ChevronDown } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';

const LiveSignal = () => {
  const [signal, setSignal] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [strategyMode, setStrategyMode] = useState('terminal'); // 'terminal' or 'basic'
  const [lookbackDays, setLookbackDays] = useState(21);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showMomentumBreakdown, setShowMomentumBreakdown] = useState(false);
  const [momentumData, setMomentumData] = useState(null);
  const [priceHistory, setPriceHistory] = useState(null);

  useEffect(() => {
    fetchLiveSignal();
    // Refresh every 5 minutes
    const interval = setInterval(fetchLiveSignal, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [strategyMode, lookbackDays]);

  const fetchLiveSignal = async () => {
    try {
      setIsLoading(true);
      const url = `http://localhost:8001/api/strategy-signals/dual_momentum?mode=${strategyMode}&lookback=${lookbackDays}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch signal');

      const data = await response.json();
      setSignal(data.signal);
      // Backend returns 'momenta' field with momentum scores
      setMomentumData(data.momenta || null);
      setPriceHistory(data.price_history || null);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError(err.message);
      console.error('Error fetching live signal:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const getSignalIcon = (hold) => {
    if (!hold) return null;
    if (hold === 'BIL') return <DollarSign className="w-6 h-6 text-yellow-400" />;
    if (hold === 'GLD') return <Shield className="w-6 h-6 text-yellow-400" />;
    return <TrendingUp className="w-6 h-6 text-green-400" />;
  };

  const getSignalColor = (hold) => {
    if (!hold) return 'text-gray-400';
    if (hold === 'BIL') return 'text-yellow-400'; // Cash/T-Bills - neutral
    if (hold === 'GLD') return 'text-yellow-400'; // Gold - risk-off
    return 'text-green-400'; // Equities - bullish
  };

  const getSignalDescription = (hold) => {
    if (!hold) return 'Waiting for signal...';
    if (hold === 'BIL') return 'Hold Cash — All assets show negative momentum';
    if (hold === 'GLD') return 'Buy Gold — Risk-off mode, safe haven preferred';
    if (hold === 'TQQQ') return '3x Leverage — Strong bullish momentum in Nasdaq';
    if (hold === 'QQQ') return 'Buy QQQ — Positive momentum in Nasdaq';
    if (hold === 'SPY') return 'Buy SPY — Positive momentum in S&P 500';
    return `Hold ${hold} — Positive momentum detected`;
  };

  if (isLoading) {
    return (
      <div className="glass p-6 rounded-lg border border-zinc-700 animate-pulse">
        <div className="h-6 bg-zinc-700 rounded mb-4 w-1/3"></div>
        <div className="h-12 bg-zinc-700 rounded"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass p-6 rounded-lg border border-red-900/30 bg-red-900/10">
        <div className="flex items-center space-x-3">
          <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0" />
          <div>
            <p className="text-red-400 font-semibold">Signal Error</p>
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass p-6 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-colors">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-white">Live Signal</h3>
            <div className="relative">
              <button
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                className="text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                <Info className="w-4 h-4" />
              </button>
              {showTooltip && (
                <div className="absolute left-0 top-6 z-50 w-56 bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-200 shadow-lg">
                  <p className="font-semibold mb-2 text-white">Dual Momentum Strategy</p>
                  <p className="mb-2">Momentum-based asset rotation:</p>
                  <ul className="list-disc list-inside space-y-1 text-zinc-300">
                    <li>{lookbackDays}-day momentum calculation</li>
                    <li>Picks highest momentum asset</li>
                    <li>Universe: TQQQ, QQQ, GLD, BIL</li>
                    <li>Cash (BIL) when all negative</li>
                  </ul>
                  <p className="mt-2 text-zinc-400">Shorter lookbacks react faster but may whipsaw. Longer lookbacks are smoother.</p>
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            🎯 Dual Momentum — {lookbackDays}-day lookback
          </p>
        </div>
        <span className="text-xs text-zinc-500">Updated: {lastUpdated}</span>
      </div>

      {/* Lookback Period Selector */}
      <div className="flex gap-2 mb-4">
        {[21, 126, 256].map((days) => (
          <button
            key={days}
            onClick={() => setLookbackDays(days)}
            className={`flex-1 px-3 py-2 text-xs rounded font-semibold transition-colors ${
              lookbackDays === days
                ? 'bg-green-500/30 text-green-400 border border-green-500/50'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'
            }`}
          >
            {days}d
          </button>
        ))}
      </div>

      <div className="flex items-center space-x-4 mb-4">
        {getSignalIcon(signal)}
        <div>
          <p className={`text-3xl font-bold ${getSignalColor(signal)}`}>
            {signal || '—'}
          </p>
          <p className="text-zinc-400 text-sm mt-1">{getSignalDescription(signal)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="glass p-2 rounded">
          <p className="text-zinc-500">Strategy</p>
          <p className="text-white font-semibold">Dual Momentum</p>
        </div>
        <div className="glass p-2 rounded">
          <p className="text-zinc-500">Lookback</p>
          <p className="text-white font-semibold">{lookbackDays} days</p>
        </div>
      </div>

      {/* Momentum Breakdown - Collapsible Section */}
      {momentumData && (
        <div className="mt-4 border-t border-zinc-700 pt-4">
          <button
            onClick={() => setShowMomentumBreakdown(!showMomentumBreakdown)}
            className="w-full flex items-center justify-between p-2 hover:bg-zinc-800/50 rounded transition-colors"
          >
            <span className="text-xs font-semibold text-zinc-400">Momentum Breakdown</span>
            <ChevronDown
              className={`w-4 h-4 text-zinc-400 transition-transform ${
                showMomentumBreakdown ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showMomentumBreakdown && (
            <div className="mt-3 space-y-2 text-xs">
              {/* Lookback Price Chart */}
              {priceHistory && priceHistory.length > 0 && (
                <div className="mb-3">
                  <p className="text-zinc-400 text-xs mb-2 font-semibold">
                    {lookbackDays}-Day Relative Performance (base = 100)
                  </p>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={priceHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis
                        dataKey="date"
                        stroke="#71717a"
                        tick={{ fill: '#71717a', fontSize: 10 }}
                        interval={lookbackDays <= 21 ? 3 : lookbackDays <= 126 ? 20 : 40}
                      />
                      <YAxis
                        stroke="#71717a"
                        tick={{ fill: '#71717a', fontSize: 10 }}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#18181b',
                          border: '1px solid #3f3f46',
                          borderRadius: '6px',
                          fontSize: '11px'
                        }}
                        labelStyle={{ color: '#a1a1aa' }}
                        formatter={(value, name) => [`${value.toFixed(2)}`, name]}
                      />
                      <ReferenceLine y={100} stroke="#3f3f46" strokeDasharray="3 3" />
                      <Legend
                        wrapperStyle={{ fontSize: '10px', color: '#a1a1aa' }}
                        iconSize={8}
                      />
                      <Line type="monotone" dataKey="TQQQ" stroke="#10b981" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="QQQ" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="GLD" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="BIL" stroke="#6b7280" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Momentum Scores */}
              {Object.entries(momentumData).map(([asset, momentum]) => (
                <div key={asset} className="flex items-center justify-between p-2 bg-zinc-800/30 rounded">
                  <span className="text-zinc-400">{asset}</span>
                  <span
                    className={`font-semibold ${
                      momentum >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {momentum >= 0 ? '+' : ''}{momentum.toFixed(2)}%
                  </span>
                </div>
              ))}
              <p className="text-zinc-500 text-xs mt-2 p-2 bg-zinc-800/20 rounded">
                {`${lookbackDays}-day momentum scores. Highest positive momentum asset is selected.`}
              </p>
            </div>
          )}
        </div>
      )}

      <button
        onClick={fetchLiveSignal}
        className="mt-4 w-full px-3 py-2 text-sm bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded border border-green-500/30 hover:border-green-500/50 transition-colors"
      >
        Refresh Signal
      </button>
    </div>
  );
};

export default LiveSignal;
