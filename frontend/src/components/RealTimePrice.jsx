import React, { useState, useEffect, useRef } from 'react';
import { wsService } from '../services/websocketService';

const RealTimePrice = ({ symbol, initialPrice, onPriceUpdate, className = '' }) => {
  const [price, setPrice] = useState(initialPrice);
  const [change, setChange] = useState(0);
  const [changePercent, setChangePercent] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);
  const previousPriceRef = useRef(initialPrice);

  useEffect(() => {
    // Reset error state
    setError(null);
    
    // Try to connect to WebSocket
    try {
      const connected = wsService.connect();
      setIsConnected(connected);

      if (connected) {
        // Subscribe to real-time updates for this symbol
        try {
          wsService.subscribe(symbol, (data) => {
            if (data.type === 'trade') {
              const newPrice = data.price;
              const priceChange = newPrice - previousPriceRef.current;
              const priceChangePercent = previousPriceRef.current > 0 
                ? (priceChange / previousPriceRef.current) * 100 
                : 0;

              setPrice(newPrice);
              setChange(priceChange);
              setChangePercent(priceChangePercent);
              setLastUpdate(new Date(data.timestamp));
              previousPriceRef.current = newPrice;

              // Call parent update function if provided
              if (onPriceUpdate) {
                onPriceUpdate(symbol, newPrice, priceChange, priceChangePercent);
              }
            }
          });
        } catch (subscribeError) {
          console.log('WebSocket subscription failed, using static price:', subscribeError.message);
          setError('Real-time updates unavailable');
          setIsConnected(false);
        }
      }
    } catch (error) {
      console.error('WebSocket connection error:', error);
      setError('WebSocket unavailable');
      setIsConnected(false);
    }

    // Cleanup
    return () => {
      try {
        wsService.unsubscribe(symbol);
      } catch (error) {
        console.error('Error unsubscribing from WebSocket:', error);
      }
    };
  }, [symbol, onPriceUpdate]);

  const formatPrice = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const formatPercent = (value) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const getPriceColor = () => {
    if (change > 0) return 'text-green-400';
    if (change < 0) return 'text-red-400';
    return 'text-gray-400';
  };

  const getConnectionStatus = () => {
    if (error) return 'text-yellow-400';
    if (isConnected) return 'text-green-400';
    return 'text-gray-400';
  };

  const getConnectionText = () => {
    if (error) return 'Error';
    if (isConnected) return 'Live';
    return 'Offline';
  };

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <div className="flex items-center space-x-1">
        <span className="text-white font-semibold">{symbol}</span>
        <span className="text-white font-bold">{formatPrice(price)}</span>
      </div>
      
      <div className={`flex items-center space-x-1 ${getPriceColor()}`}>
        <span className="text-sm">
          {change >= 0 ? '+' : ''}{change.toFixed(2)}
        </span>
        <span className="text-sm">
          ({formatPercent(changePercent)})
        </span>
      </div>

      <div className="flex items-center space-x-2">
        <div className={`w-2 h-2 rounded-full ${getConnectionStatus()}`} />
        <span className="text-xs text-gray-400">
          {getConnectionText()}
        </span>
        {lastUpdate && (
          <span className="text-xs text-gray-400">
            {lastUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
};

export default RealTimePrice;
