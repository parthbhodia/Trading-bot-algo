import React, { useState } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';

const TradingToolbar = ({ indicators = {}, onToggleIndicator = () => {} }) => {
  const [isOpen, setIsOpen] = useState(false);

  const availableIndicators = [
    { id: 'rsi', name: 'RSI (14)', description: 'Relative Strength Index', category: 'Momentum' },
    { id: 'macd', name: 'MACD', description: 'Moving Average Convergence Divergence', category: 'Trend' },
    { id: 'bollinger', name: 'Bollinger Bands', description: 'Volatility Bands', category: 'Volatility' },
    { id: 'volume', name: 'Volume', description: 'Trading Volume', category: 'Volume' },
    { id: 'stochastic', name: 'Stochastic', description: 'Momentum Oscillator', category: 'Momentum' },
    { id: 'atr', name: 'ATR (14)', description: 'Average True Range', category: 'Volatility' },
  ];

  const categories = [...new Set(availableIndicators.map(ind => ind.category))];

  return (
    <div className="relative">
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-sm text-white transition"
      >
        <span>📊 Indicators</span>
        <ChevronDown className={`w-4 h-4 transition ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-50 p-3">
          {categories.map(category => (
            <div key={category} className="mb-3">
              <h4 className="text-xs font-semibold text-zinc-400 uppercase mb-2">{category}</h4>
              <div className="space-y-2 pl-2">
                {availableIndicators
                  .filter(ind => ind.category === category)
                  .map(indicator => (
                    <label
                      key={indicator.id}
                      className="flex items-center space-x-2 cursor-pointer hover:bg-zinc-800 p-2 rounded transition"
                    >
                      <input
                        type="checkbox"
                        checked={indicators[indicator.id] || false}
                        onChange={() => onToggleIndicator(indicator.id)}
                        className="w-4 h-4 rounded border-zinc-600"
                      />
                      <div className="flex-1">
                        <div className="text-sm text-white">{indicator.name}</div>
                        <div className="text-xs text-zinc-500">{indicator.description}</div>
                      </div>
                      <div className="text-xs">
                        {indicators[indicator.id] ? (
                          <Eye className="w-4 h-4 text-green-400" />
                        ) : (
                          <EyeOff className="w-4 h-4 text-zinc-600" />
                        )}
                      </div>
                    </label>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TradingToolbar;
