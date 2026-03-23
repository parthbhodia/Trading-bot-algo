import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { MarketDataService } from '../../services/marketData';

const VIXChart = () => {
  const [vixData, setVixData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchVIXData = async () => {
      try {
        setIsLoading(true);
        const data = await MarketDataService.getVIXData(30);
        setVixData(data);
        setError(null);
      } catch (err) {
        setError('Failed to fetch VIX data');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchVIXData();
  }, []);

  const getRegimeColor = (vix) => {
    if (vix < 15) return '#10b981'; // Green - Low volatility
    if (vix < 25) return '#f59e0b'; // Amber - Normal volatility
    if (vix < 35) return '#ef4444'; // Red - High volatility
    return '#991b1b'; // Dark red - Extreme volatility
  };

  const currentVIX = vixData.length > 0 ? vixData[vixData.length - 1].vix : 0;
  const regime = currentVIX < 15 ? 'Low Volatility' : 
                currentVIX < 25 ? 'Normal Market' : 
                currentVIX < 35 ? 'High Volatility' : 'Extreme Fear';

  if (isLoading) {
    return (
      <div className="h-64 flex items-center justify-center text-zinc-400">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mx-auto mb-4"></div>
          <p>Loading VIX data...</p>
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

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-zinc-400 text-sm">Current VIX</p>
          <p className="text-2xl font-bold" style={{ color: getRegimeColor(currentVIX) }}>
            {currentVIX.toFixed(1)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-zinc-400 text-sm">Market Regime</p>
          <p className="text-lg font-semibold text-white">{regime}</p>
        </div>
      </div>
      
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={vixData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis 
            dataKey="date" 
            stroke="#9ca3af"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
          />
          <YAxis 
            stroke="#9ca3af"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            domain={[0, 'dataMax + 5']}
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#1f2937', 
              border: '1px solid #374151',
              borderRadius: '8px'
            }}
            labelStyle={{ color: '#f3f4f6' }}
            itemStyle={{ color: '#f3f4f6' }}
          />
          <ReferenceLine y={15} stroke="#10b981" strokeDasharray="5 5" label="Low Vol" />
          <ReferenceLine y={25} stroke="#f59e0b" strokeDasharray="5 5" label="Normal" />
          <ReferenceLine y={35} stroke="#ef4444" strokeDasharray="5 5" label="High Vol" />
          <Line 
            type="monotone" 
            dataKey="vix" 
            stroke="#8b5cf6" 
            strokeWidth={2}
            dot={false}
            name="VIX"
          />
          <Line 
            type="monotone" 
            dataKey="sma" 
            stroke="#6b7280" 
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            name="20 SMA"
          />
        </LineChart>
      </ResponsiveContainer>
      
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="glass p-3 rounded">
          <p className="text-zinc-400 text-xs">30-Day High</p>
          <p className="text-white font-semibold">{Math.max(...vixData.map(d => d.vix)).toFixed(1)}</p>
        </div>
        <div className="glass p-3 rounded">
          <p className="text-zinc-400 text-xs">30-Day Low</p>
          <p className="text-white font-semibold">{Math.min(...vixData.map(d => d.vix)).toFixed(1)}</p>
        </div>
      </div>
    </div>
  );
};

export default VIXChart;
