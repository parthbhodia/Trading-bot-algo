// Shared types between frontend and backend

export interface Position {
  symbol: string;
  shares: number;
  avg_cost: number;
  market_price: number;
  market_value: number;
  pnl: number;
  pnl_pct: number;
  allocation: number;
}

export interface PortfolioData {
  total_value: number;
  initial_value: number;
  daily_pnl: number;
  daily_pnl_pct: number;
  total_return: number;
  cash: number;
  positions: Position[];
}

export interface MarketData {
  [symbol: string]: {
    price: number;
    timestamp: string;
    error?: string;
  };
}

export interface VIXData {
  current_vix: number;
  regime: 'LOW' | 'MODERATE' | 'HIGH';
  z_score: number;
  data_points: number;
  last_updated: string;
}

export interface PerformanceData {
  symbol: string;
  period: string;
  initial_price: number;
  current_price: number;
  total_return: number;
  volatility: number;
  max_drawdown: number;
  data_points: number;
  last_updated: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}
