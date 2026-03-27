import { API_BASE_URL } from "../config.js";
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { TrendingUp, TrendingDown, Minus, RefreshCw, DollarSign, Activity, PieChart, BarChart3, Wifi, WifiOff, Plus, X, Trash2, Pencil, Check, Calendar, Newspaper } from 'lucide-react';
import { formatCurrency, formatPercent, getProfitClass, cn } from '../lib/utils';
import VIXChart from './charts/VIXChart';
import PerformanceChart from './charts/PerformanceChart';
import BacktestChart from './charts/BacktestChart';
import MacroCharts from './charts/MacroCharts';
import LiveSignal from './LiveSignal';
import { MarketDataService } from '../services/marketData';
import RealTimePrice from './RealTimePrice';
import { wsService } from '../services/websocketService';

const Dashboard = () => {
  const [portfolioData, setPortfolioData] = useState({
    totalValue: 0,
    initialValue: 100000,
    dailyPnL: 0,
    dailyPnLPct: 0,
    totalReturn: 0,
    cash: 0,
    positions: [],
    error: null,
    isLoading: true
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isRealTimeConnected, setIsRealTimeConnected] = useState(false);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [newPos, setNewPos] = useState({ symbol: '', shares: '', avgCost: '' });
  const [addPosError, setAddPosError] = useState(null);
  const [addPosLoading, setAddPosLoading] = useState(false);

  // ── Inline edit state ────────────────────────────────────────────────────
  const [editingPos, setEditingPos] = useState(null);       // symbol being edited
  const [editVals, setEditVals] = useState({ shares: '', avgCost: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState(null);

  // ── Earnings & News state ─────────────────────────────────────────────────
  const NEWS_SYMBOLS = ['PLTR', 'NVDA', 'MSFT', 'ORCL', 'AVGO', 'POET'];
  const [earningsData, setEarningsData] = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState(null);
  const [selectedNewsSymbol, setSelectedNewsSymbol] = useState('PLTR');
  const [newsCache, setNewsCache] = useState({});   // { PLTR: {sentiment, bullets, articles} }
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);

  useEffect(() => {
    // Check WebSocket connection status
    const checkConnection = () => {
      const connected = wsService.isConnected();
      setIsRealTimeConnected(connected);
    };

    const interval = setInterval(checkConnection, 5000);

    // Try to load portfolio data on mount
    loadPortfolioData();
    loadEarnings();
    loadNews('PLTR');

    return () => clearInterval(interval);
  }, []);

  // Load news when user switches symbol tab
  useEffect(() => {
    loadNews(selectedNewsSymbol);
  }, [selectedNewsSymbol]);

  const loadPortfolioData = async () => {
    try {
      setPortfolioData(prev => ({ ...prev, isLoading: true, error: null }));
      
      // Try to get real portfolio data from backend
      const response = await fetch(`${API_BASE_URL}/api/portfolio`);
      
      if (response.ok) {
        const raw = await response.json();
        const data = {
          totalValue: raw.total_value,
          initialValue: raw.initial_value,
          dailyPnL: raw.daily_pnl,
          dailyPnLPct: raw.daily_pnl_pct,
          totalReturn: raw.total_return,
          cash: raw.cash,
          positions: (raw.positions || []).map(p => ({
            symbol: p.symbol,
            shares: p.shares,
            avgCost: p.avg_cost,
            marketPrice: p.market_price,
            marketValue: p.market_value,
            pnl: p.pnl,
            pnlPct: p.pnl_pct,
            allocation: p.allocation
          }))
        };
        setPortfolioData(prev => ({
          ...prev,
          ...data,
          isLoading: false,
          error: null
        }));
      } else {
        throw new Error('Portfolio API not available');
      }
    } catch (error) {
      console.log('Portfolio API not available, using empty state');
      setPortfolioData(prev => ({
        ...prev,
        isLoading: false,
        error: 'Portfolio data not available - Backend not running'
      }));
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      if (portfolioData.positions.length === 0) {
        // No positions to refresh
        setPortfolioData(prev => ({
          ...prev,
          error: 'No portfolio positions to refresh'
        }));
        return;
      }

      // Fetch real-time prices for portfolio positions
      const updatedPositions = await Promise.all(
        portfolioData.positions.map(async (position) => {
          try {
            const marketData = await MarketDataService.getCurrentPrice(position.symbol);
            if (marketData) {
              const newMarketValue = position.shares * marketData.price;
              const newPnL = newMarketValue - (position.shares * position.avgCost);
              const newPnLPct = (newPnL / (position.shares * position.avgCost)) * 100;
              
              return {
                ...position,
                marketPrice: marketData.price,
                marketValue: newMarketValue,
                pnl: newPnL,
                pnlPct: newPnLPct,
                dailyPnL: marketData.change * position.shares,
                dailyPnLPct: marketData.changePercent
              };
            }
            return position;
          } catch (error) {
            console.error(`Error fetching price for ${position.symbol}:`, error);
            return position;
          }
        })
      );

      const newTotalValue = updatedPositions.reduce((sum, pos) => sum + pos.marketValue, 0) + portfolioData.cash;
      const totalDailyPnL = updatedPositions.reduce((sum, pos) => sum + (pos.dailyPnL || 0), 0);
      const previousDayValue = newTotalValue - totalDailyPnL;
      const totalDailyPnLPct = previousDayValue > 0 ? (totalDailyPnL / previousDayValue) * 100 : 0;

      setPortfolioData(prev => ({
        ...prev,
        positions: updatedPositions,
        totalValue: newTotalValue,
        dailyPnL: totalDailyPnL,
        dailyPnLPct: totalDailyPnLPct,
        totalReturn: ((newTotalValue - prev.initialValue) / prev.initialValue) * 100,
        error: null
      }));
    } catch (error) {
      console.error('Error refreshing portfolio data:', error);
      setPortfolioData(prev => ({
        ...prev,
        error: 'Failed to refresh portfolio data'
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // Update daily P&L when real-time prices change
  const updatePositionPrice = (symbol, newPrice, change, changePercent) => {
    setPortfolioData(prev => {
      const updatedPositions = prev.positions.map(position => {
        if (position.symbol === symbol) {
          const newMarketValue = position.shares * newPrice;
          const newPnL = newMarketValue - (position.shares * position.avgCost);
          const newPnLPct = (newPnL / (position.shares * position.avgCost)) * 100;
          const dailyPnL = change * position.shares;
          
          return {
            ...position,
            marketPrice: newPrice,
            marketValue: newMarketValue,
            pnl: newPnL,
            pnlPct: newPnLPct,
            dailyPnL: dailyPnL,
            dailyPnLPct: changePercent
          };
        }
        return position;
      });

      const newTotalValue = updatedPositions.reduce((sum, pos) => sum + pos.marketValue, 0) + prev.cash;
      const totalDailyPnL = updatedPositions.reduce((sum, pos) => sum + (pos.dailyPnL || 0), 0);
      const previousDayValue = newTotalValue - totalDailyPnL;
      const totalDailyPnLPct = previousDayValue > 0 ? (totalDailyPnL / previousDayValue) * 100 : 0;

      return {
        ...prev,
        positions: updatedPositions,
        totalValue: newTotalValue,
        dailyPnL: totalDailyPnL,
        dailyPnLPct: totalDailyPnLPct
      };
    });
  };

  const buildPositionsPayload = (extra = null, removeSymbol = null) => {
    const positions = {};
    portfolioData.positions.forEach(p => {
      if (p.symbol !== removeSymbol) {
        positions[p.symbol] = { shares: p.shares, avg_cost: p.avgCost };
      }
    });
    if (extra) {
      positions[extra.symbol.toUpperCase()] = {
        shares: parseFloat(extra.shares),
        avg_cost: parseFloat(extra.avgCost),
      };
    }
    return positions;
  };

  const handleAddPosition = async (e) => {
    e.preventDefault();
    if (!newPos.symbol || !newPos.shares || !newPos.avgCost) {
      setAddPosError('All fields are required');
      return;
    }
    setAddPosLoading(true);
    setAddPosError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/portfolio/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions: buildPositionsPayload(newPos) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to save position');
      }
      setShowAddPosition(false);
      setNewPos({ symbol: '', shares: '', avgCost: '' });
      await loadPortfolioData();
    } catch (err) {
      setAddPosError(err.message);
    } finally {
      setAddPosLoading(false);
    }
  };

  const handleRemovePosition = async (symbol) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/portfolio/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions: buildPositionsPayload(null, symbol) }),
      });
      if (res.ok) await loadPortfolioData();
    } catch (err) {
      console.error('Remove position error:', err);
    }
  };

  const handleEditSave = async (symbol) => {
    if (!editVals.shares || !editVals.avgCost || isNaN(editVals.shares) || isNaN(editVals.avgCost)) {
      setEditError('Enter valid numbers for shares and avg cost');
      return;
    }
    setEditLoading(true);
    setEditError(null);
    try {
      const positions = {};
      portfolioData.positions.forEach(p => {
        if (p.symbol === symbol) {
          positions[p.symbol] = { shares: parseFloat(editVals.shares), avg_cost: parseFloat(editVals.avgCost) };
        } else {
          positions[p.symbol] = { shares: p.shares, avg_cost: p.avgCost };
        }
      });
      const res = await fetch(`${API_BASE_URL}/api/portfolio/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setEditingPos(null);
      await loadPortfolioData();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditLoading(false);
    }
  };

  // ── Earnings loader ───────────────────────────────────────────────────────
  const loadEarnings = async () => {
    setEarningsLoading(true);
    setEarningsError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/earnings?symbols=PLTR,NVDA,MSFT,ORCL,AVGO,POET`);
      if (!res.ok) throw new Error('Earnings API unavailable');
      const data = await res.json();
      setEarningsData(data.earnings || []);
    } catch (e) {
      setEarningsError('Could not load earnings — backend may be starting');
    } finally {
      setEarningsLoading(false);
    }
  };

  // ── News loader ───────────────────────────────────────────────────────────
  const loadNews = async (symbol, force = false) => {
    if (!force && newsCache[symbol]) return;   // use cached result
    setNewsLoading(true);
    setNewsError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/news/${symbol}`);
      if (!res.ok) throw new Error(`News API returned ${res.status}`);
      const data = await res.json();
      setNewsCache(prev => ({ ...prev, [symbol]: data }));
    } catch (e) {
      setNewsError(`Could not load news for ${symbol}`);
    } finally {
      setNewsLoading(false);
    }
  };

  const getProfitIcon = (value) => {
    if (value > 0) return <TrendingUp className="w-4 h-4" />;
    if (value < 0) return <TrendingDown className="w-4 h-4" />;
    return <Minus className="w-4 h-4" />;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent">
              Stock Analysis Platform
            </h1>
            <p className="text-zinc-400 mt-2">Real-time portfolio tracking and market analysis</p>
            <div className="flex items-center space-x-4">
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${
                wsService.isDemoMode() 
                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' 
                  : isRealTimeConnected 
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                    : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                {wsService.isDemoMode() ? (
                  <>
                    <Activity className="w-4 h-4" />
                    <span className="text-sm font-medium">Demo Mode</span>
                  </>
                ) : isRealTimeConnected ? (
                  <>
                    <Wifi className="w-4 h-4" />
                    <span className="text-sm font-medium">Live</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4" />
                    <span className="text-sm font-medium">Offline</span>
                  </>
                )}
              </div>
              <span className="text-zinc-400 text-sm">
                {wsService.getConnectionStatus()}
              </span>
            </div>
            
            <div className="flex items-center gap-3 mt-3">
              <Button
                onClick={handleRefresh}
                disabled={isLoading}
                className="glass hover:bg-white/10"
              >
                <RefreshCw className={cn(`w-4 h-4 mr-2`, isLoading && `animate-spin`)} />
                Refresh
              </Button>
              <a
                href="/news"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 text-sm font-medium transition-colors"
              >
                <Newspaper className="w-4 h-4" />
                Market Intelligence
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Portfolio Metrics */}
      {portfolioData.error ? (
        <Card className="glass-card border-yellow-500/30">
          <CardContent className="p-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-yellow-500/20 rounded-full flex items-center justify-center">
                <Activity className="w-8 h-8 text-yellow-400" />
              </div>
              <h3 className="text-xl font-semibold text-yellow-400 mb-2">Portfolio Data Not Available</h3>
              <p className="text-zinc-400 mb-4">{portfolioData.error}</p>
              <div className="space-y-2 text-sm text-zinc-500">
                <p>• Backend server not running</p>
                <p>• No portfolio positions configured</p>
                <p>• API endpoints not available</p>
              </div>
              <Button 
                onClick={loadPortfolioData}
                disabled={isLoading}
                className="mt-4 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400"
              >
                <RefreshCw className={cn(`w-4 h-4 mr-2`, isLoading && `animate-spin`)} />
                Retry Loading
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : portfolioData.positions.length === 0 ? (
        <Card className="glass-card border-blue-500/30">
          <CardContent className="p-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-blue-500/20 rounded-full flex items-center justify-center">
                <PieChart className="w-8 h-8 text-blue-400" />
              </div>
              <h3 className="text-xl font-semibold text-blue-400 mb-2">No Portfolio Positions</h3>
              <p className="text-zinc-400 mb-4">Add your first position to start tracking</p>
              <Button
                onClick={() => setShowAddPosition(true)}
                className="bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Position
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="glass-card hover:bg-white/10 transition-all duration-300">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-zinc-400 text-sm">Portfolio Value</p>
                  <p className="text-2xl font-bold text-white">
                    {formatCurrency(portfolioData.totalValue)}
                  </p>
                  <p className="text-zinc-500 text-xs">
                    Initial: {formatCurrency(portfolioData.initialValue)}
                  </p>
                </div>
                <DollarSign className="w-8 h-8 text-green-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card hover:bg-white/10 transition-all duration-300">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-zinc-400 text-sm">Daily P&L</p>
                  <p className={cn(`text-2xl font-bold`, getProfitClass(portfolioData.dailyPnL))}>
                    {formatPercent(portfolioData.dailyPnLPct)}
                  </p>
                  <p className={cn(`text-xs`, getProfitClass(portfolioData.dailyPnL))}>
                    {formatCurrency(portfolioData.dailyPnL)}
                  </p>
                </div>
                {getProfitIcon(portfolioData.dailyPnL)}
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card hover:bg-white/10 transition-all duration-300">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-zinc-400 text-sm">Total Return</p>
                  <p className={cn(`text-2xl font-bold`, getProfitClass(portfolioData.totalReturn))}>
                    {formatPercent(portfolioData.totalReturn)}
                  </p>
                  <p className={cn(`text-xs`, getProfitClass(portfolioData.totalReturn))}>
                    {formatCurrency(portfolioData.totalValue - portfolioData.initialValue)}
                </p>
              </div>
              {getProfitIcon(portfolioData.totalReturn)}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card hover:bg-white/10 transition-all duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-400 text-sm">Cash Position</p>
                <p className="text-2xl font-bold text-white">
                  {formatCurrency(portfolioData.cash)}
                </p>
                <p className="text-zinc-500 text-xs">
                  {portfolioData.cash > 0 ? 
                    `${((portfolioData.cash / portfolioData.totalValue) * 100).toFixed(1)}%` : 
                    '0.0%'
                  }
                </p>
              </div>
              <Activity className="w-8 h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
        </div>
      )}

      {/* Current Positions */}
      {!portfolioData.error && portfolioData.positions.length > 0 && (
        <Card className="glass-card mb-8">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PieChart className="w-5 h-5 text-green-400" />
                Current Positions
              </div>
              <Button
                onClick={() => setShowAddPosition(true)}
                className="bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 text-sm py-1 px-3"
              >
                <Plus className="w-3 h-3 mr-1" />
                Add
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {portfolioData.positions.map((position) => (
                <div key={position.symbol} className="glass-card p-6 hover:bg-white/10 transition-all duration-300">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <h3 className="text-xl font-bold text-white">{position.symbol}</h3>
                      <Badge 
                        variant={(position.pnl || 0) > 0 ? `profit` : (position.pnl || 0) < 0 ? `loss` : `neutral`}
                        className="flex items-center gap-1"
                      >
                        {getProfitIcon(position.pnlPct || 0)}
                        {formatPercent(position.pnlPct)}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-zinc-400">{position.allocation || 0}% of portfolio</p>
                      {/* Real-time price display */}
                      <RealTimePrice 
                        symbol={position.symbol} 
                        initialPrice={position.marketPrice || 0}
                        onPriceUpdate={updatePositionPrice}
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    {/* Shares — editable */}
                    <div>
                      <p className="text-zinc-400 text-sm mb-1">Shares</p>
                      {editingPos === position.symbol ? (
                        <input
                          type="number"
                          value={editVals.shares}
                          onChange={e => setEditVals(v => ({ ...v, shares: e.target.value }))}
                          className="w-full bg-zinc-800 text-white text-lg font-semibold px-2 py-1 rounded border border-green-500/60 focus:outline-none focus:border-green-400"
                        />
                      ) : (
                        <p className="text-lg font-semibold text-white">{(position.shares || 0).toFixed(2)}</p>
                      )}
                    </div>
                    {/* Avg Cost — editable */}
                    <div>
                      <p className="text-zinc-400 text-sm mb-1">Avg Cost</p>
                      {editingPos === position.symbol ? (
                        <input
                          type="number"
                          value={editVals.avgCost}
                          onChange={e => setEditVals(v => ({ ...v, avgCost: e.target.value }))}
                          className="w-full bg-zinc-800 text-white text-lg font-semibold px-2 py-1 rounded border border-green-500/60 focus:outline-none focus:border-green-400"
                        />
                      ) : (
                        <p className="text-lg font-semibold text-white">{formatCurrency(position.avgCost)}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-zinc-400 text-sm mb-1">Market Price</p>
                      <p className="text-lg font-semibold text-white">{formatCurrency(position.marketPrice)}</p>
                    </div>
                    <div>
                      <p className="text-zinc-400 text-sm mb-1">Market Value</p>
                      <p className={cn(`text-lg font-semibold`, getProfitClass(position.pnl))}>
                        {formatCurrency(position.marketValue)}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-zinc-800 pt-4 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                      <div>
                        <span className="text-zinc-400 text-sm">P&L Amount: </span>
                        <span className={cn(`font-semibold`, getProfitClass(position.pnl))}>
                          {formatCurrency(position.pnl)}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-400 text-sm">Cost Basis: </span>
                        <span className="font-semibold text-white">
                          {formatCurrency((position.marketValue || 0) - (position.pnl || 0))}
                        </span>
                      </div>
                      {editError && editingPos === position.symbol && (
                        <span className="text-red-400 text-xs">{editError}</span>
                      )}
                    </div>
                    {/* Action buttons */}
                    <div className="flex items-center gap-2">
                      {editingPos === position.symbol ? (
                        <>
                          <button
                            onClick={() => handleEditSave(position.symbol)}
                            disabled={editLoading}
                            className="flex items-center gap-1 text-xs text-green-400 border border-green-500/50 px-2 py-1 rounded hover:bg-green-500/10 transition-colors disabled:opacity-50"
                            title="Save changes"
                          >
                            <Check className="w-3 h-3" />
                            {editLoading ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingPos(null); setEditError(null); }}
                            className="flex items-center gap-1 text-xs text-zinc-400 border border-zinc-600 px-2 py-1 rounded hover:bg-zinc-700 transition-colors"
                            title="Cancel"
                          >
                            <X className="w-3 h-3" />
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setEditingPos(position.symbol);
                              setEditVals({ shares: String(position.shares), avgCost: String(position.avgCost) });
                              setEditError(null);
                            }}
                            className="text-zinc-500 hover:text-blue-400 transition-colors p-1 rounded"
                            title="Edit shares / avg cost"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRemovePosition(position.symbol)}
                            className="text-zinc-500 hover:text-red-400 transition-colors p-1 rounded"
                            title="Remove position"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      )}

      {/* ── Earnings Dates + News ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">

        {/* Upcoming Earnings — dynamic from /api/earnings */}
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-yellow-400" />
                Upcoming Earnings
              </CardTitle>
              <button
                onClick={loadEarnings}
                disabled={earningsLoading}
                className="text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
                title="Refresh earnings"
              >
                <RefreshCw className={`w-4 h-4 ${earningsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {earningsLoading && earningsData.length === 0 ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-zinc-800/40 animate-pulse" />
                ))}
              </div>
            ) : earningsError && earningsData.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-zinc-500 text-sm">{earningsError}</p>
                <button onClick={loadEarnings} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
                  Try again
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {earningsData
                  .filter(e => e.date)
                  .sort((a, b) => new Date(a.date) - new Date(b.date))
                  .map(e => {
                    const daysUntil = Math.ceil((new Date(e.date) - new Date()) / 86400000);
                    const dateLabel = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    // Beat/miss badge config
                    const bmCfg = {
                      beat:   { label: '✅ BEAT',    cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
                      miss:   { label: '❌ MISS',    cls: 'bg-red-500/20   text-red-400   border-red-500/30'   },
                      inline: { label: '≈ IN-LINE', cls: 'bg-zinc-700     text-zinc-400  border-zinc-600'     },
                    }[e.beat_miss] || null;
                    return (
                      <div key={e.symbol} className={`p-3 rounded-lg bg-zinc-800/40 border ${e.confirmed ? 'border-green-500/30' : 'border-yellow-500/30'}`}>
                        {/* Top row: symbol + date + countdown */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-white font-bold w-12 text-sm">{e.symbol}</span>
                            <div>
                              <p className="text-white text-sm font-medium">{dateLabel}</p>
                              <p className={`text-xs ${e.confirmed ? 'text-green-400' : 'text-yellow-400'}`}>
                                {e.confirmed ? 'Confirmed' : 'Estimated'}
                                {e.eps_est != null ? ` · EPS est $${Number(e.eps_est).toFixed(2)}` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`font-bold text-sm ${daysUntil <= 30 ? 'text-yellow-400' : 'text-zinc-300'}`}>
                              {daysUntil}d
                            </p>
                            <p className="text-zinc-500 text-xs">to go</p>
                          </div>
                        </div>
                        {/* Last quarter beat/miss row */}
                        {(bmCfg || e.last_actual != null) && (
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-zinc-700/50 flex-wrap">
                            {bmCfg && (
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${bmCfg.cls}`}>
                                {bmCfg.label}
                              </span>
                            )}
                            {e.last_actual != null && (
                              <span className="text-xs text-zinc-400">
                                Last EPS: <span className="text-white font-medium">${Number(e.last_actual).toFixed(2)}</span>
                                {e.last_est != null && (
                                  <> vs est <span className="text-zinc-300">${Number(e.last_est).toFixed(2)}</span></>
                                )}
                                {e.surprise_pct != null && (
                                  <span className={`ml-1 font-medium ${e.surprise_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    ({e.surprise_pct >= 0 ? '+' : ''}{Number(e.surprise_pct).toFixed(1)}%)
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                {earningsData.filter(e => !e.date).length > 0 && (
                  <p className="text-zinc-600 text-xs pt-1">
                    No date available: {earningsData.filter(e => !e.date).map(e => e.symbol).join(', ')}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Market Pulse — dynamic from /api/news/{symbol} via Grok */}
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-blue-400" />
                Market Pulse
              </CardTitle>
              {newsCache[selectedNewsSymbol] && (
                <button
                  onClick={() => {
                    setNewsCache(prev => { const n = { ...prev }; delete n[selectedNewsSymbol]; return n; });
                    loadNews(selectedNewsSymbol, true);
                  }}
                  disabled={newsLoading}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
                  title="Refresh AI summary"
                >
                  <RefreshCw className={`w-4 h-4 ${newsLoading ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Symbol tabs */}
            <div className="flex gap-1.5 mb-4 flex-wrap">
              {NEWS_SYMBOLS.map(sym => (
                <button
                  key={sym}
                  onClick={() => setSelectedNewsSymbol(sym)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    selectedNewsSymbol === sym
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                      : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-700'
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>

            {/* Content */}
            {newsLoading && !newsCache[selectedNewsSymbol] ? (
              <div className="py-8 text-center">
                <div className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-zinc-500 text-sm">Generating AI summary...</p>
                <p className="text-zinc-600 text-xs mt-1">Grok is reading the headlines</p>
              </div>
            ) : newsError && !newsCache[selectedNewsSymbol] ? (
              <div className="text-center py-6">
                <p className="text-zinc-500 text-sm">{newsError}</p>
                <button
                  onClick={() => loadNews(selectedNewsSymbol, true)}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300"
                >
                  Try again
                </button>
              </div>
            ) : newsCache[selectedNewsSymbol] ? (() => {
              const nd = newsCache[selectedNewsSymbol];
              const sentimentColor =
                nd.sentiment === 'bullish' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                nd.sentiment === 'bearish' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
              return (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${sentimentColor}`}>
                      {nd.sentiment?.toUpperCase()}
                    </span>
                    <span className="text-zinc-500 text-xs">
                      {nd.articles?.length || 0} headlines · AI by Grok
                    </span>
                    {nd.generated && (
                      <span className="text-zinc-600 text-xs ml-auto">
                        {new Date(nd.generated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {nd.bullets?.map((b, i) => (
                      <div key={i} className="flex gap-2 text-xs items-start">
                        <span className={`shrink-0 mt-0.5 ${b.type === 'bull' ? 'text-green-400' : 'text-red-400'}`}>
                          {b.type === 'bull' ? '🟢' : '🔴'}
                        </span>
                        <span className="text-zinc-300 leading-relaxed">{b.text}</span>
                      </div>
                    ))}
                  </div>
                  {nd.articles?.length > 0 && (
                    <details className="mt-3">
                      <summary className="text-zinc-600 text-xs cursor-pointer hover:text-zinc-400 transition-colors">
                        {nd.articles.length} source headlines ↓
                      </summary>
                      <div className="mt-2 space-y-1.5 pl-2 border-l border-zinc-800">
                        {nd.articles.map((a, i) => (
                          <div key={i} className="text-xs">
                            <a
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-400 hover:text-blue-400 transition-colors leading-tight block"
                            >
                              {a.title}
                            </a>
                            <span className="text-zinc-600">{a.publisher} · {a.date}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })() : (
              <div className="py-6 text-center text-zinc-600 text-sm">
                Select a symbol to load AI summary
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Market Analysis Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-green-400" />
              Market Regime Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VIXChart />
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-400" />
              Performance Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PerformanceChart />
          </CardContent>
        </Card>
      </div>

      {/* ── Macro Charts: Oil + US Dollar ─────────────────────────────────── */}
      <Card className="glass-card mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <span className="text-lg">🌍</span>
              Global Macro
              <span className="text-zinc-500 text-sm font-normal">Oil & US Dollar</span>
            </CardTitle>
            <a
              href="/news"
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors border border-blue-500/30 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20"
            >
              <Newspaper className="w-3.5 h-3.5" />
              Full News →
            </a>
          </div>
        </CardHeader>
        <CardContent>
          <MacroCharts />
        </CardContent>
      </Card>

      {/* Live Signal Section */}
      <div className="mb-8">
        <LiveSignal />
      </div>

      {/* Trading Strategy Backtest Section */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-green-400" />
            TQQQ Trading Strategy Backtest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <BacktestChart />
        </CardContent>
      </Card>

      {/* Add Position Modal */}
      {showAddPosition && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card border border-zinc-700 rounded-xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-semibold text-white">Add Position</h3>
              <button
                onClick={() => { setShowAddPosition(false); setAddPosError(null); setNewPos({ symbol: '', shares: '', avgCost: '' }); }}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddPosition} className="space-y-4">
              <div>
                <label className="text-zinc-400 text-sm block mb-1">Ticker Symbol</label>
                <input
                  type="text"
                  placeholder="e.g. AAPL, QQQ, GLD"
                  value={newPos.symbol}
                  onChange={e => setNewPos(p => ({ ...p, symbol: e.target.value.toUpperCase() }))}
                  className="w-full bg-zinc-800 text-white px-3 py-2 rounded border border-zinc-700 focus:border-green-400 focus:outline-none uppercase placeholder:normal-case"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-zinc-400 text-sm block mb-1">Number of Shares</label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="e.g. 10.5"
                  value={newPos.shares}
                  onChange={e => setNewPos(p => ({ ...p, shares: e.target.value }))}
                  className="w-full bg-zinc-800 text-white px-3 py-2 rounded border border-zinc-700 focus:border-green-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-zinc-400 text-sm block mb-1">Average Cost per Share ($)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 450.00"
                    value={newPos.avgCost}
                    onChange={e => setNewPos(p => ({ ...p, avgCost: e.target.value }))}
                    className="flex-1 bg-zinc-800 text-white px-3 py-2 rounded border border-zinc-700 focus:border-green-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!newPos.symbol || newPos.fetchingPrice}
                    onClick={async () => {
                      if (!newPos.symbol) return;
                      setNewPos(p => ({ ...p, fetchingPrice: true }));
                      setAddPosError(null);
                      try {
                        const res = await fetch(`${API_BASE_URL}/api/performance/${newPos.symbol}?period=5d`);
                        if (!res.ok) throw new Error('Invalid ticker');
                        const data = await res.json();
                        if (data.current_price) {
                          setNewPos(p => ({ ...p, avgCost: data.current_price.toFixed(2), fetchingPrice: false }));
                        } else {
                          throw new Error('No price data');
                        }
                      } catch (err) {
                        setAddPosError(`Could not fetch price for ${newPos.symbol}`);
                        setNewPos(p => ({ ...p, fetchingPrice: false }));
                      }
                    }}
                    className="px-3 py-2 text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/30 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {newPos.fetchingPrice ? '...' : 'Live Price'}
                  </button>
                </div>
              </div>

              {/* Total Cost Preview */}
              {newPos.shares && newPos.avgCost && (
                (() => {
                  const totalCost = parseFloat(newPos.shares) * parseFloat(newPos.avgCost);
                  const availableCash = portfolioData.cash || 0;
                  const exceedsCash = availableCash > 0 && totalCost > availableCash;
                  return (
                    <div className={`p-3 rounded border ${exceedsCash ? 'border-red-500/50 bg-red-500/10' : 'border-zinc-700 bg-zinc-800/50'}`}>
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Total Cost</span>
                        <span className={`font-semibold ${exceedsCash ? 'text-red-400' : 'text-white'}`}>
                          ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      {availableCash > 0 && (
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-zinc-500">Available Cash</span>
                          <span className="text-zinc-400">${availableCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      {exceedsCash && (
                        <p className="text-red-400 text-xs mt-2">⚠ Insufficient cash — exceeds available balance by ${(totalCost - availableCash).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      )}
                      {availableCash > 0 && !exceedsCash && (
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-zinc-500">Remaining Cash</span>
                          <span className="text-green-400">${(availableCash - totalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}

              {addPosError && (
                <p className="text-red-400 text-sm">{addPosError}</p>
              )}

              <div className="flex gap-3 pt-1">
                <Button
                  type="submit"
                  disabled={addPosLoading || (portfolioData.cash > 0 && newPos.shares && newPos.avgCost && parseFloat(newPos.shares) * parseFloat(newPos.avgCost) > portfolioData.cash)}
                  className="flex-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {addPosLoading ? 'Saving...' : 'Add Position'}
                </Button>
                <Button
                  type="button"
                  onClick={() => { setShowAddPosition(false); setAddPosError(null); setNewPos({ symbol: '', shares: '', avgCost: '' }); }}
                  className="flex-1 glass hover:bg-white/10 text-zinc-400"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
