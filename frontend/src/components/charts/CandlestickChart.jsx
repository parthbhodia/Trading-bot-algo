import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Bar, ReferenceLine } from 'recharts';
import { ZoomIn, ZoomOut, RotateCcw, Crosshair } from 'lucide-react';
import TradingToolbar from './TradingToolbar';

// Technical Indicator Calculations
const calculateRSI = (prices, period = 14) => {
  const deltas = [];
  for (let i = 1; i < prices.length; i++) {
    deltas.push(prices[i] - prices[i - 1]);
  }

  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    if (deltas[i] > 0) gains += deltas[i];
    else losses -= deltas[i];
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

const calculateBollingerBands = (prices, period = 20, stdDev = 2) => {
  const sma = prices.reduce((a, b) => a + b) / prices.length;
  const variance = prices.reduce((sq, n) => sq + Math.pow(n - sma, 2), 0) / prices.length;
  const stdDeviation = Math.sqrt(variance);
  return {
    upper: sma + stdDeviation * stdDev,
    middle: sma,
    lower: sma - stdDeviation * stdDev,
  };
};

const CandlestickChart = ({ data, symbol = 'Symbol' }) => {
  const [zoomDomain, setZoomDomain] = useState([0, 100]);
  const [hoveredCandle, setHoveredCandle] = useState(null);
  const [cursorPosition, setCursorPosition] = useState(null);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [activeIndicators, setActiveIndicators] = useState({
    rsi: false,
    macd: false,
    bollinger: false,
    volume: false,
    stochastic: false,
    atr: false,
  });

  const handleToggleIndicator = (indicatorId) => {
    setActiveIndicators(prev => ({
      ...prev,
      [indicatorId]: !prev[indicatorId]
    }));
  };

  // Filter data based on zoom level
  const zoomedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const [start, end] = zoomDomain;
    const startIdx = Math.floor((start / 100) * data.length);
    const endIdx = Math.floor((end / 100) * data.length);
    return data.slice(startIdx, endIdx);
  }, [data, zoomDomain]);

  const handleZoomIn = () => {
    const [start, end] = zoomDomain;
    const mid = (start + end) / 2;
    const range = (end - start) / 4;
    setZoomDomain([Math.max(0, mid - range), Math.min(100, mid + range)]);
  };

  const handleZoomOut = () => {
    const [start, end] = zoomDomain;
    const mid = (start + end) / 2;
    const range = (end - start);
    setZoomDomain([Math.max(0, mid - range), Math.min(100, mid + range)]);
  };

  const handleReset = () => {
    setZoomDomain([0, 100]);
  };

  const CandleStick = (props) => {
    const { x, y, width, height, payload } = props;
    if (!payload || typeof payload.open !== 'number' || typeof payload.close !== 'number') {
      return null;
    }

    const yScale = height / (props.yAxisDomain ? props.yAxisDomain[1] - props.yAxisDomain[0] : 1);
    const yOffset = y;

    const openY = yOffset + height - (payload.open - (props.yAxisDomain ? props.yAxisDomain[0] : 0)) * yScale;
    const closeY = yOffset + height - (payload.close - (props.yAxisDomain ? props.yAxisDomain[0] : 0)) * yScale;
    const highY = yOffset + height - (payload.high - (props.yAxisDomain ? props.yAxisDomain[0] : 0)) * yScale;
    const lowY = yOffset + height - (payload.low - (props.yAxisDomain ? props.yAxisDomain[0] : 0)) * yScale;

    const wickX = x + width / 2;
    const bodyWidth = Math.max(width * 0.6, 2);
    const bodyX = x + (width - bodyWidth) / 2;

    const isGain = payload.close >= payload.open;
    const color = isGain ? '#10b981' : '#ef4444';
    const bodyColor = isGain ? '#10b981' : '#ef4444';

    return (
      <g>
        {/* Wick */}
        <line x1={wickX} y1={highY} x2={wickX} y2={lowY} stroke={color} strokeWidth={1} />

        {/* Body */}
        <rect
          x={bodyX}
          y={Math.min(openY, closeY)}
          width={bodyWidth}
          height={Math.abs(closeY - openY) || 1}
          fill={bodyColor}
          stroke={color}
          strokeWidth={1}
        />
      </g>
    );
  };

  if (!data || data.length === 0) {
    return <div className="text-zinc-400 p-4">No data available</div>;
  }

  const minPrice = Math.min(...data.map(d => d.low || d.close));
  const maxPrice = Math.max(...data.map(d => d.high || d.close));
  const priceRange = maxPrice - minPrice;
  const yAxisDomain = [minPrice - priceRange * 0.1, maxPrice + priceRange * 0.1];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <button
            onClick={handleZoomIn}
            className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700 text-zinc-400 hover:text-white transition"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700 text-zinc-400 hover:text-white transition"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={handleReset}
            className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700 text-zinc-400 hover:text-white transition"
            title="Reset View"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Crosshair Toggle */}
          <div className="w-px h-6 bg-zinc-700"></div>
          <button
            onClick={() => setShowCrosshair(!showCrosshair)}
            className={`p-2 rounded border transition ${
              showCrosshair
                ? 'bg-green-900/30 border-green-500 text-green-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
            }`}
            title="Toggle Crosshair"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        </div>

        {/* Indicator Toolbar */}
        <TradingToolbar
          indicators={activeIndicators}
          onToggleIndicator={handleToggleIndicator}
        />

        {/* Zoom Level Display */}
        <div className="text-sm text-zinc-400 text-right">
          <div>Showing {zoomedData.length} of {data.length} candles</div>
          {hoveredCandle && (
            <div className="text-xs mt-1 text-zinc-300">
              O: ${hoveredCandle.open.toFixed(2)} | H: ${hoveredCandle.high.toFixed(2)} | L: ${hoveredCandle.low.toFixed(2)} | C: ${hoveredCandle.close.toFixed(2)}
            </div>
          )}
          {cursorPosition && showCrosshair && (
            <div className="text-xs mt-1 text-yellow-400 font-mono">
              {cursorPosition.date} | ${cursorPosition.price.toFixed(2)}
            </div>
          )}
        </div>
      </div>

      {/* Candlestick Chart */}
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart
          data={zoomedData}
          margin={{ top: 20, right: 30, left: 60, bottom: 60 }}
          onMouseMove={(state) => {
            if (state.isTooltipActive && state.activeTooltipIndex !== undefined) {
              const dataPoint = zoomedData[state.activeTooltipIndex];
              setCursorPosition({
                date: dataPoint.date,
                price: dataPoint.close || dataPoint.ticker_price,
              });
            }
          }}
          onMouseLeave={() => setCursorPosition(null)}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="date"
            stroke="#9ca3af"
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            angle={-45}
            textAnchor="end"
            height={80}
            interval={Math.floor(zoomedData.length / 8) || 0}
          />
          <YAxis
            stroke="#9ca3af"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            domain={yAxisDomain}
            label={{ value: symbol, angle: -90, position: 'insideLeft' }}
            tickFormatter={(value) => `$${value.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '2px solid #10b981',
              borderRadius: '6px',
              padding: '10px',
              fontFamily: 'monospace',
              fontSize: '12px'
            }}
            cursor={showCrosshair ? { stroke: '#60a5fa', strokeDasharray: '5 5', strokeWidth: 1.5 } : false}
            content={({ active, payload, label }) => {
              if (active && payload && payload[0]) {
                const data = payload[0].payload;
                return (
                  <div className="bg-zinc-900 border-2 border-green-500 rounded p-2 text-white text-xs">
                    <div className="font-bold text-green-400 mb-1">{label}</div>
                    <div>O: ${data.open?.toFixed(2) || data.close?.toFixed(2)}</div>
                    <div>H: ${data.high?.toFixed(2) || data.close?.toFixed(2)}</div>
                    <div>L: ${data.low?.toFixed(2) || data.close?.toFixed(2)}</div>
                    <div className="font-bold text-cyan-400 mt-1">C: ${data.close?.toFixed(2) || data.ticker_price?.toFixed(2)}</div>
                  </div>
                );
              }
              return null;
            }}
          />

          {/* Candlestick Shape */}
          <Bar
            dataKey="close"
            shape={<CandleStick yAxisDomain={yAxisDomain} />}
            isAnimationActive={false}
            onMouseEnter={(data) => setHoveredCandle(data)}
            onMouseLeave={() => setHoveredCandle(null)}
          />

          {/* Price Line Overlay */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="close"
            stroke="#60a5fa"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
            opacity={0.3}
          />

          {/* Buy/Sell Signal Badges */}
          {zoomedData.map((item, idx) => {
            if (item.signal === 'BUY' || item.signal === 'SELL') {
              const isBuy = item.signal === 'BUY';
              return (
                <ReferenceLine
                  key={`signal-${idx}`}
                  x={item.date}
                  stroke="transparent"
                  label={{
                    value: `${isBuy ? '🟢 BUY' : '🔴 SELL'} $${item.close?.toFixed(2) || item.ticker_price?.toFixed(2)}`,
                    position: isBuy ? 'bottom' : 'top',
                    fill: isBuy ? '#10b981' : '#ef4444',
                    fontSize: 12,
                    fontWeight: 'bold',
                    backgroundColor: isBuy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                  }}
                  strokeWidth={2}
                  stroke={isBuy ? '#10b981' : '#ef4444'}
                  strokeDasharray="0"
                />
              );
            }
            return null;
          })}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center space-x-6 text-xs text-zinc-400">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-green-500"></div>
          <span>Up (Close > Open)</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-red-500"></div>
          <span>Down (Close &lt; Open)</span>
        </div>
      </div>
    </div>
  );
};

export default CandlestickChart;
