import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { RefreshCw } from 'lucide-react';

const PERIODS = [
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: '1Y', value: '1y'  },
];

const CustomTooltip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-400 mb-1">{label}</p>
      <p className="text-white font-semibold">{payload[0].value.toFixed(2)} {unit}</p>
    </div>
  );
};

const MiniChart = ({ data, color, unit, loading }) => {
  if (loading) {
    return <div className="h-32 flex items-center justify-center">
      <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: `${color}33`, borderTopColor: color }} />
    </div>;
  }
  if (!data?.length) {
    return <div className="h-32 flex items-center justify-center text-zinc-600 text-xs">No data</div>;
  }

  // Show every ~10th label to avoid crowding
  const tickInterval = Math.floor(data.length / 5);

  return (
    <ResponsiveContainer width="100%" height={128}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#71717a', fontSize: 9 }}
          tickLine={false}
          interval={tickInterval}
          tickFormatter={d => {
            const dt = new Date(d);
            return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }}
        />
        <YAxis
          tick={{ fill: '#71717a', fontSize: 9 }}
          tickLine={false}
          domain={['auto', 'auto']}
          tickFormatter={v => v.toFixed(0)}
        />
        <Tooltip content={<CustomTooltip unit={unit} />} />
        <Line
          type="monotone"
          dataKey="price"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, fill: color }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

const MacroCharts = () => {
  const [macroData, setMacroData] = useState(null);
  const [period, setPeriod]       = useState('3mo');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:8001/api/macro-data?period=${period}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMacroData(await res.json());
    } catch (e) {
      setError('Could not load macro data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [period]);

  const PctBadge = ({ val }) => {
    if (val == null) return null;
    const pos = val >= 0;
    return (
      <span className={`text-xs font-medium ${pos ? 'text-green-400' : 'text-red-400'}`}>
        {pos ? '+' : ''}{val.toFixed(2)}%
      </span>
    );
  };

  const cards = [
    {
      key:   'oil',
      color: '#f59e0b',       // amber
      icon:  '🛢️',
      label: 'WTI Crude Oil',
    },
    {
      key:   'dxy',
      color: '#60a5fa',       // blue
      icon:  '💵',
      label: 'US Dollar Index (DXY)',
    },
  ];

  return (
    <div>
      {/* Period selector + refresh */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                period === p.value
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error ? (
        <div className="text-center py-8 text-zinc-500 text-sm">
          <p>{error}</p>
          <button onClick={fetchData} className="mt-2 text-xs text-blue-400 hover:text-blue-300">Retry</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {cards.map(({ key, color, icon, label }) => {
            const d = macroData?.[key];
            return (
              <div key={key} className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-800">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-base">{icon}</span>
                      <span className="text-zinc-300 text-sm font-medium">{label}</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-white">
                        {d?.current != null
                          ? (key === 'oil' ? `$${d.current.toFixed(2)}` : d.current.toFixed(2))
                          : '—'}
                      </span>
                      <span className="text-zinc-500 text-xs">{d?.unit}</span>
                    </div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <div className="flex items-center gap-1 justify-end">
                      <span className="text-zinc-600 text-xs">1d</span>
                      <PctBadge val={d?.change_pct} />
                    </div>
                    <div className="flex items-center gap-1 justify-end">
                      <span className="text-zinc-600 text-xs">1w</span>
                      <PctBadge val={d?.week_chg} />
                    </div>
                    <div className="flex items-center gap-1 justify-end">
                      <span className="text-zinc-600 text-xs">1m</span>
                      <PctBadge val={d?.month_chg} />
                    </div>
                  </div>
                </div>

                {/* Chart */}
                <MiniChart
                  data={d?.series}
                  color={color}
                  unit={d?.unit || ''}
                  loading={loading && !macroData}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MacroCharts;
