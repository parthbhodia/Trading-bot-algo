// Browser-compatible market data service using Finnhub API + Yahoo Finance
export class MarketDataService {
  static lastApiCall = 0;
  static apiCallCooldown = 100; // 100ms between API calls (10 calls/second)
  static callQueue = [];
  static isProcessingQueue = false;

  static getApiKey() {
    // Try browser-compatible ways to get the API key
    const apiKey = import.meta.env?.VITE_FINNHUB_API_KEY || 
                   globalThis?.VITE_FINNHUB_API_KEY ||
                   'd6l5iu9r01qptf3oti3gd6l5iu9r01qptf3oti40'; // Fallback to hardcoded key
    
    console.log('API Key check:', apiKey ? 'Found' : 'Not found', apiKey.substring(0, 10) + '...');
    return apiKey;
  }

  static async rateLimitedFetch(url) {
    return new Promise((resolve, reject) => {
      this.callQueue.push({ url, resolve, reject });
      this.processCallQueue();
    });
  }

  static processCallQueue() {
    if (this.isProcessingQueue || this.callQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    const processNext = async () => {
      if (this.callQueue.length === 0) {
        this.isProcessingQueue = false;
        return;
      }

      // Rate limiting - wait if needed
      const now = Date.now();
      const timeSinceLastCall = now - this.lastApiCall;
      if (timeSinceLastCall < this.apiCallCooldown) {
        setTimeout(processNext, this.apiCallCooldown - timeSinceLastCall);
        return;
      }

      const { url, resolve, reject } = this.callQueue.shift();
      this.lastApiCall = now;

      try {
        const response = await fetch(url);
        const data = await response.json();
        resolve({ response, data });
      } catch (error) {
        reject(error);
      }

      // Process next call
      setTimeout(processNext, 50); // Small delay between calls
    };

    processNext();
  }

  // Yahoo Finance integration with CORS proxy - Option 2
  static async getYahooFinanceData(symbol, period = '1y') {
    try {
      // Use CORS proxy to bypass browser restrictions
      const endDate = Math.floor(Date.now() / 1000);
      const startDate = endDate - (365 * 24 * 60 * 60); // 1 year ago

      // Try multiple CORS proxy options
      const proxyUrls = [
        `https://corsproxy.io/?https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startDate}&period2=${endDate}&interval=1d`,
        `https://api.allorigins.win/raw?url=https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startDate}&period2=${endDate}&interval=1d`,
        `https://cors-anywhere.herokuapp.com/https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startDate}&period2=${endDate}&interval=1d`
      ];

      let data = null;
      let lastError = null;

      for (const proxyUrl of proxyUrls) {
        try {
          console.log(`Trying proxy: ${proxyUrl.substring(0, 50)}...`);
          const response = await fetch(proxyUrl);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const responseData = await response.json();
          
          // Handle different proxy response formats
          const actualData = responseData.contents ? JSON.parse(responseData.contents) : responseData;
          
          if (actualData.chart && actualData.chart.result && actualData.chart.result.length > 0) {
            const result = actualData.chart.result[0];
            const timestamps = result.timestamp || [];
            const quotes = result.indicators.quote[0] || {};
            const closes = quotes.close || [];
            const volumes = quotes.volume || [];

            data = timestamps.map((timestamp, index) => ({
              date: new Date(timestamp * 1000),
              close: closes[index] || null,
              volume: volumes[index] || null,
              open: quotes.open?.[index] || null,
              high: quotes.high?.[index] || null,
              low: quotes.low?.[index] || null
            })).filter(item => item.close !== null);

            console.log(`Successfully fetched ${symbol} data via proxy`);
            break;
          } else {
            throw new Error(`No data found in response from ${proxyUrl}`);
          }
        } catch (error) {
          console.log(`Proxy failed: ${error.message}`);
          lastError = error;
          continue; // Try next proxy
        }
      }

      if (!data) {
        throw lastError || new Error(`All proxies failed for ${symbol}`);
      }

      return data;
    } catch (error) {
      console.error(`Error fetching Yahoo Finance data for ${symbol}:`, error);
      throw error;
    }
  }

  static async getYahooFinanceVIX() {
    try {
      return await this.getYahooFinanceData('^VIX', '1mo');
    } catch (error) {
      console.error('Error fetching VIX data from Yahoo Finance:', error);
      throw error;
    }
  }

  static async getVIXData(days = 30) {
    try {
      const apiKey = this.getApiKey();
      if (!apiKey || apiKey === 'demo') {
        throw new Error('No Finnhub API key configured');
      }

      // Try Finnhub first for current VIX price only
      let currentVIX = null;
      try {
        const { response, data } = await this.rateLimitedFetch(
          `https://finnhub.io/api/v1/quote?symbol=^VIX&token=${apiKey}`
        );
        
        if (data && data.c && data.c !== 0) {
          currentVIX = data.c;
          console.log(`Got current VIX from Finnhub: ${currentVIX}`);
        } else {
          throw new Error('Invalid VIX quote data');
        }
      } catch (finnhubError) {
        console.log('Finnhub VIX failed, trying Yahoo Finance for current price:', finnhubError.message);
        
        // Try Yahoo Finance for current VIX
        const yahooData = await this.getYahooFinanceVIX();
        if (yahooData && yahooData.length > 0) {
          currentVIX = yahooData[yahooData.length - 1].close;
          console.log(`Got current VIX from Yahoo Finance: ${currentVIX}`);
        } else {
          throw new Error('No VIX data available from any source');
        }
      }

      // Now get full historical data from Yahoo Finance
      try {
        const yahooData = await this.getYahooFinanceVIX();
        
        if (yahooData && yahooData.length > 0) {
          // Use real Yahoo Finance data
          const vixData = yahooData.slice(-days).map(item => ({
            date: item.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            vix: item.close,
            sma: null
          }));
          
          // Calculate SMA for all points
          for (let i = 0; i < vixData.length; i++) {
            vixData[i].sma = this.calculateSMAfromArray(vixData.map(d => d.vix), i, 20);
          }
          
          console.log(`Using real VIX data from Yahoo Finance: ${vixData.length} days`);
          return vixData;
        } else {
          throw new Error('No historical VIX data available');
        }
      } catch (yahooError) {
        console.error('Yahoo Finance VIX failed:', yahooError);
        throw new Error('VIX historical data unavailable - Yahoo Finance API blocked by CORS');
      }
    } catch (error) {
      console.error('Error fetching VIX data:', error);
      throw error;
    }
  }

  static async getHistoricalPerformance(symbols = ['SPY', 'QQQ', 'GLD'], years = 10) {
    try {
      const performanceData = {};
      
      // Fetch data for each symbol
      for (const symbol of symbols) {
        try {
          // Try Finnhub first
          try {
            const apiKey = this.getApiKey();
            if (!apiKey || apiKey === 'demo') {
              throw new Error('No Finnhub API key configured');
            }

            // Try to get historical data (may not work with free API)
            const endDate = Math.floor(Date.now() / 1000);
            const startDate = endDate - (years * 365 * 24 * 60 * 60); // years ago in seconds
            
            const { response, data } = await this.rateLimitedFetch(
              `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${startDate}&to=${endDate}&token=${apiKey}`
            );
            
            // Handle rate limiting errors
            if (response.status === 429) {
              throw new Error('Rate limit exceeded');
            }
            
            if (data.s === 'ok' && data.t && data.c) {
              // Format data for charts
              performanceData[symbol] = data.t.map((timestamp, index) => ({
                date: new Date(timestamp * 1000),
                close: data.c[index]
              }));
            } else {
              throw new Error(`${symbol} historical data requires paid subscription`);
            }
          } catch (finnhubError) {
            console.log(`Finnhub ${symbol} failed, trying Yahoo Finance:`, finnhubError.message);
            
            // Fallback to Yahoo Finance
            const yahooData = await this.getYahooFinanceData(symbol, `${years}y`);
            performanceData[symbol] = yahooData;
          }
        } catch (error) {
          console.error(`Error fetching ${symbol} historical data:`, error);
          throw error;
        }
      }

      // Aggregate by year
      const yearlyData = this.aggregateByYear(performanceData, symbols);
      return yearlyData;
    } catch (error) {
      console.error('Error fetching performance data:', error);
      throw error;
    }
  }

  static async getCurrentPrice(symbol) {
    try {
      const apiKey = this.getApiKey();
      if (!apiKey || apiKey === 'demo') {
        throw new Error('No Finnhub API key configured');
      }

      // Use rate-limited fetch
      const { response, data } = await this.rateLimitedFetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`
      );

      // Handle rate limiting errors
      if (response.status === 429) {
        throw new Error('Rate limit exceeded - please wait before making more requests');
      }

      // Handle CFD indices that require subscription
      if (data.error && data.error.includes('subscription required')) {
        throw new Error(`${symbol} requires paid Finnhub subscription`);
      }

      if (data && data.c && data.c !== 0) {
        return {
          symbol: symbol,
          price: data.c, // Current price
          change: data.d, // Change
          changePercent: data.dp, // Change percentage
          volume: null, // Not available in quote endpoint
          marketCap: null
        };
      } else {
        throw new Error(`Invalid quote data for ${symbol}`);
      }
    } catch (error) {
      console.error(`Error fetching ${symbol} quote:`, error);
      throw error; // Don't use fallback - just show the error
    }
  }

  static calculateSMAfromArray(data, currentIndex, period) {
    if (currentIndex < period - 1 || !data[currentIndex]) return null;
    
    let sum = 0;
    let count = 0;
    for (let i = currentIndex - period + 1; i <= currentIndex; i++) {
      if (data[i] !== null && data[i] !== undefined) {
        sum += data[i];
        count++;
      }
    }
    return count > 0 ? sum / count : null;
  }

  static aggregateByYear(marketData, symbols) {
    const yearlyData = [];
    const currentYear = new Date().getFullYear();
    
    for (let year = currentYear - 10; year <= currentYear; year++) {
      const yearData = { year: year.toString() };
      
      // Add market data for each symbol
      symbols.forEach(symbol => {
        const symbolData = marketData[symbol];
        if (symbolData && symbolData.length > 0) {
          const yearDataPoint = symbolData[0];
          if (yearDataPoint) {
            // Normalize to reasonable values
            yearData[symbol.toLowerCase()] = Math.round(yearDataPoint.close * 100);
          }
        }
      });
      
      // Add portfolio data (mock calculation based on SPY performance)
      if (yearData.spy) {
        const baseValue = 100000;
        const growth = (yearData.spy / 100000 - 1) * 1.1; // Slightly outperform SPY
        yearData.portfolio = Math.round(baseValue * (1 + growth) * ((year - currentYear + 10) * 0.1 + 1));
      }
      
      if (Object.keys(yearData).length > 1) {
        yearlyData.push(yearData);
      }
    }
    
    return yearlyData;
  }
}
