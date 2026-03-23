// Real-time WebSocket service for Finnhub
export class WebSocketService {
  constructor() {
    this.ws = null;
    this.subscriptions = new Set();
    this.callbacks = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.apiKey = this.getApiKey();
    this.isDemo = !this.apiKey || this.apiKey === 'demo';
    
    // Rate limiting
    this.lastConnectionAttempt = 0;
    this.connectionCooldown = 5000; // 5 seconds between connection attempts
    this.subscriptionQueue = [];
    this.isProcessingQueue = false;
  }

  getApiKey() {
    // Try browser-compatible ways to get the API key
    const apiKey = import.meta.env?.VITE_FINNHUB_API_KEY || 
                   globalThis?.VITE_FINNHUB_API_KEY ||
                   'd6l5iu9r01qptf3oti3gd6l5iu9r01qptf3oti40'; // Fallback to hardcoded key
    
    console.log('WebSocket API Key check:', apiKey ? 'Found' : 'Not found', apiKey.substring(0, 10) + '...');
    return apiKey;
  }

  connect() {
    if (this.isDemo) {
      console.log('WebSocket service disabled - Demo API key detected');
      return false;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return true;
    }

    // Rate limiting - don't connect too frequently
    const now = Date.now();
    if (now - this.lastConnectionAttempt < this.connectionCooldown) {
      console.log(`WebSocket connection cooldown: ${this.connectionCooldown - (now - this.lastConnectionAttempt)}ms remaining`);
      return false;
    }

    this.lastConnectionAttempt = now;

    try {
      console.log('Connecting to WebSocket...');
      // Force WebSocket transport to avoid 400 errors and polling fallback
      this.ws = new WebSocket(`wss://ws.finnhub.io?token=${this.apiKey}`);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected successfully');
        this.reconnectAttempts = 0;
        
        // Process subscription queue with delay to avoid rate limits
        setTimeout(() => {
          this.processSubscriptionQueue();
        }, 100);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        this.handleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        // Mark as failed and don't retry if demo key
        if (this.isDemo) {
          this.ws = null;
        }
      };

      return true;
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      return false;
    }
  }

  handleMessage(data) {
    const { type, data: messageData } = data;
    
    switch (type) {
      case 'trade':
        this.handleTradeData(messageData);
        break;
      case 'news':
        this.handleNewsData(messageData);
        break;
      case 'pr':
        this.handlePressReleaseData(messageData);
        break;
      default:
        console.log('Unknown message type:', type);
    }
  }

  handleTradeData(trades) {
    trades.forEach(trade => {
      const { s: symbol, p: price, t: timestamp, v: volume } = trade;
      
      // Update all callbacks for this symbol
      const callbacks = this.callbacks.get(symbol);
      if (callbacks) {
        callbacks.forEach(callback => {
          callback({
            type: 'trade',
            symbol,
            price: parseFloat(price),
            timestamp: parseInt(timestamp),
            volume: parseFloat(volume || 0)
          });
        });
      }
    });
  }

  handleNewsData(newsData) {
    const callbacks = this.callbacks.get('news');
    if (callbacks) {
      callbacks.forEach(callback => {
        callback({
          type: 'news',
          data: newsData
        });
      });
    }
  }

  handlePressReleaseData(prData) {
    const callbacks = this.callbacks.get('press-releases');
    if (callbacks) {
      callbacks.forEach(callback => {
        callback({
          type: 'press-release',
          data: prData
        });
      });
    }
  }

  processSubscriptionQueue() {
    if (this.isProcessingQueue || this.subscriptionQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    console.log(`Processing ${this.subscriptionQueue.length} queued subscriptions`);

    // Process subscriptions with delay to avoid rate limits
    const processNext = (index) => {
      if (index >= this.subscriptionQueue.length) {
        this.subscriptionQueue = [];
        this.isProcessingQueue = false;
        return;
      }

      const { symbol, callback } = this.subscriptionQueue[index];
      
      // Add delay between subscriptions (100ms)
      setTimeout(() => {
        this.sendSubscription(symbol);
        processNext(index + 1);
      }, 100);
    };

    processNext(0);
  }

  subscribe(symbol, callback) {
    if (this.isDemo) {
      console.log(`WebSocket not available (demo key) - Cannot subscribe to ${symbol}`);
      throw new Error('WebSocket not available in demo mode');
    }

    // Store callback for this symbol
    if (!this.callbacks.has(symbol)) {
      this.callbacks.set(symbol, new Set());
    }
    this.callbacks.get(symbol).add(callback);

    // Add to subscriptions
    this.subscriptions.add(symbol);

    // Force WebSocket-only connection to avoid 400 errors
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.connect()) {
        console.error('Failed to connect WebSocket');
        // Don't throw error, just log it to avoid crashing
        console.log('WebSocket unavailable - using polling fallback');
        return false;
      }
      
      // Add to queue for when connection is ready
      this.subscriptionQueue.push({ symbol, callback });
      return true;
    }

    // WebSocket is already connected, add to queue for processing
    this.subscriptionQueue.push({ symbol, callback });
    return true;
  }

  sendSubscription(symbol) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not ready for subscription');
      return false;
    }

    // Send subscription message
    const message = JSON.stringify({
      type: 'subscribe',
      symbol: symbol
    });
    
    try {
      this.ws.send(message);
      console.log(`Subscribed to ${symbol}`);
      return true;
    } catch (error) {
      console.error('Failed to send subscription:', error);
      return false;
    }
  }

  subscribeToNews(callback) {
    if (this.isDemo) {
      console.log('WebSocket not available (demo key) - Cannot subscribe to news');
      throw new Error('WebSocket not available in demo mode');
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.connect()) {
        console.error('Failed to connect WebSocket');
        throw new Error('WebSocket connection failed');
      }
    }

    // Store callback for news
    if (!this.callbacks.has('news')) {
      this.callbacks.set('news', new Set());
    }
    this.callbacks.get('news').add(callback);

    // Send news subscription message
    const message = JSON.stringify({
      type: 'subscribe-news',
      symbol: 'general'
    });
    
    this.ws.send(message);
    console.log('Subscribed to news');
    return true;
  }

  unsubscribe(symbol) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.isDemo) {
      return false;
    }

    // Remove from subscriptions
    this.subscriptions.delete(symbol);

    // Remove callbacks
    this.callbacks.delete(symbol);

    // Send unsubscribe message
    const message = JSON.stringify({
      type: 'unsubscribe',
      symbol: symbol
    });
    
    this.ws.send(message);
    console.log(`Unsubscribed from ${symbol}`);
    return true;
  }

  handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts && !this.isDemo) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('Max reconnection attempts reached - WebSocket disabled');
      // Mark as permanently failed to stop retrying
      this.ws = null;
      this.reconnectAttempts = this.maxReconnectAttempts;
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
    this.callbacks.clear();
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN && !this.isDemo;
  }

  getConnectionStatus() {
    if (this.isDemo) {
      return 'Demo Mode - WebSocket not available';
    }
    if (!this.ws) {
      return 'Disconnected';
    }
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'Connecting...';
      case WebSocket.OPEN:
        return 'Connected';
      case WebSocket.CLOSING:
        return 'Closing...';
      case WebSocket.CLOSED:
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  }

  isDemoMode() {
    return this.isDemo;
  }
}

// Singleton instance
export const wsService = new WebSocketService();
