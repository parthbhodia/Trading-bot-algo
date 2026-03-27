import { API_BASE_URL } from "../../config.js";
import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const PerformanceChart = () => {
  const [data, setData] = useState(null);
  const [allPeriodsData, setAllPeriodsData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('10y');
  const [selectedAsset, setSelectedAsset] = useState('spy');
  const [hiddenLines, setHiddenLines] = useState({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const res = await fetch(`${API_BASE_URL}/api/performance/comparison?period=${period}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Failed to fetch performance data');
        }
        setData(await res.json());
        setError(null);
      } catch (err) {
        setError(err.message);
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [period]);

  useEffect(() => {
    // Fetch all periods data on component mount for summary display
    const fetchAllPeriods = async () => {
      const periods = ['1y', '3y', '5y', '10y'];
      const results = {};

      try {
        for (const p of periods) {
          const res = await fetch(`${API_BASE_URL}/api/performance/comparison?period=${p}`);
          if (res.ok) {
            results[p] = await res.json();
          }
        }
        setAllPeriodsData(results);
      } catch (err) {
        console.error('Error fetching all periods:', err);
      }
    };

    fetchAllPeriods();
  }, []);

  if (isLoading) {
    return (
      <div className="h-64 flex items-center justify-center text-zinc-400">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mx-auto mb-4"></div>
          <p>Loading performance data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-64 flex items-center justify-center text-zinc-400">
        <div className="text-center">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  const { yearly_data, total_return, annualized_return, best_year, worst_year, has_portfolio } = data;

  const getAssetMetrics = (asset) => {
    // Calculate total and annualized return for the selected asset
    if (!yearly_data || yearly_data.length < 2) {
      return { total: 0, annualized: 0 };
    }

    const firstValue = yearly_data[0][asset] || 100;
    const lastValue = yearly_data[yearly_data.length - 1][asset] || 100;
    const totalReturn = ((lastValue - firstValue) / firstValue) * 100;

    // Use the selected period for accurate annualization
    const periodYears = { '1y': 1, '3y': 3, '5y': 5, '10y': 10 };
    const years = periodYears[period] || 1;
    const annualizedReturn = (Math.pow(lastValue / firstValue, 1 / years) - 1) * 100;

    return { total: totalReturn, annualized: annualizedReturn };
  };

  const assetMetrics = getAssetMetrics(selectedAsset);

  const handleLegendClick = (e) => {
    const key = e.dataKey;
    setHiddenLines(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-4">
      {/* Header row with Asset Selector */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <label className="text-zinc-400 text-sm">Asset:</label>
            <select
              value={selectedAsset}
              onChange={(e) => setSelectedAsset(e.target.value)}
              className="bg-zinc-800 text-white px-3 py-1 rounded border border-zinc-700 focus:border-green-400 focus:outline-none text-sm"
            >
              <option value="spy">📊 S&P 500 (SPY)</option>
              <option value="qqq">📈 Nasdaq (QQQ)</option>
              <option value="gld">🏆 Gold (GLD)</option>
              {has_portfolio && <option value="portfolio">🎯 Portfolio</option>}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-zinc-400 text-sm">Total Return</p>
              <p className={`text-2xl font-bold ${assetMetrics.total >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {assetMetrics.total >= 0 ? '+' : ''}{assetMetrics.total.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-zinc-400 text-sm">Annualized Return</p>
              <p className={`text-2xl font-bold ${assetMetrics.annualized >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {assetMetrics.annualized >= 0 ? '+' : ''}{assetMetrics.annualized.toFixed(2)}%
              </p>
            </div>
          </div>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="bg-zinc-800 text-white px-3 py-2 rounded border border-zinc-700 focus:border-green-400 focus:outline-none text-sm h-fit"
        >
          <option value="1y">1 Year</option>
          <option value="3y">3 Years</option>
          <option value="5y">5 Years</option>
          <option value="10y">10 Years</option>
        </select>
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={yearly_data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="year"
            stroke="#9ca3af"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
          />
          <YAxis
            stroke="#9ca3af"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
            labelStyle={{ color: '#f3f4f6' }}
            formatter={(value, name) => [`$${value?.toLocaleString() || 0}`, name]}
          />
          <Legend
            wrapperStyle={{ color: '#f3f4f6', cursor: 'pointer' }}
            iconType="line"
            onClick={handleLegendClick}
          />

          {has_portfolio && (
            <Line type="monotone" dataKey="portfolio" stroke="#10b981" strokeWidth={3} dot={false} name="Portfolio" hide={!!hiddenLines['portfolio']} />
          )}
          <Line type="monotone" dataKey="spy" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 5" dot={false} name="S&P 500" hide={!!hiddenLines['spy']} />
          <Line type="monotone" dataKey="qqq" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="3 3" dot={false} name="QQQ" hide={!!hiddenLines['qqq']} />
          <Line type="monotone" dataKey="gld" stroke="#f59e0b" strokeWidth={2} strokeDasharray="8 3" dot={false} name="GLD" hide={!!hiddenLines['gld']} />
        </LineChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="glass p-3 rounded">
          <p className="text-zinc-400 text-xs">Best Year</p>
          <p className="text-green-400 font-semibold">
            {best_year.year} ({best_year.return >= 0 ? '+' : ''}{best_year.return}%)
          </p>
        </div>
        <div className="glass p-3 rounded">
          <p className="text-zinc-400 text-xs">Worst Year</p>
          <p className="text-red-400 font-semibold">
            {worst_year.year} ({worst_year.return >= 0 ? '+' : ''}{worst_year.return}%)
          </p>
        </div>
      </div>

      {/* All Periods Summary */}
      {allPeriodsData && (
        <div className="border-t border-zinc-700 pt-4 mt-4">
          <p className="text-zinc-400 text-xs mb-3 font-semibold">Performance Across All Periods</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {['1y', '3y', '5y', '10y'].map((p) => {
              const periodData = allPeriodsData[p];
              if (!periodData || !periodData.yearly_data || periodData.yearly_data.length < 2) return null;
              const isSelected = p === period;
              const periodYearsMap = { '1y': 1, '3y': 3, '5y': 5, '10y': 10 };
              const pYears = periodYearsMap[p] || 1;
              const yd = periodData.yearly_data;
              const first = yd[0][selectedAsset] || 100;
              const last = yd[yd.length - 1][selectedAsset] || 100;
              const totalRet = ((last - first) / first) * 100;
              const annRet = (Math.pow(last / first, 1 / pYears) - 1) * 100;
              return (
                <div
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`glass p-3 rounded cursor-pointer transition-colors ${
                    isSelected
                      ? 'border border-green-500/50 bg-green-500/10'
                      : 'border border-zinc-700 hover:border-zinc-600'
                  }`}
                >
                  <p className="text-zinc-400 text-xs">
                    {p === '1y' ? '1 Year' : p === '3y' ? '3 Years' : p === '5y' ? '5 Years' : '10 Years'}
                  </p>
                  <p className={`text-sm font-semibold ${
                    totalRet >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {totalRet >= 0 ? '+' : ''}{totalRet.toFixed(2)}%
                  </p>
                  <p className="text-zinc-500 text-xs mt-1">
                    {annRet >= 0 ? '+' : ''}{annRet.toFixed(2)}% Ann.
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-zinc-500 text-xs text-center mt-2">
            Click any period card to update the chart above
          </p>
        </div>
      )}

      {!has_portfolio && (
        <p className="text-zinc-500 text-xs text-center">
          Add positions to your portfolio to see your blended performance line
        </p>
      )}
    </div>
  );
};

export default PerformanceChart;
