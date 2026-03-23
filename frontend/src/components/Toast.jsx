import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, X } from 'lucide-react';

const Toast = ({ message, type = 'info', duration = 3000, onClose }) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!isVisible) return null;

  const bgColor = {
    success: 'bg-green-500/20 border-green-500/50',
    error: 'bg-red-500/20 border-red-500/50',
    warning: 'bg-yellow-500/20 border-yellow-500/50',
    info: 'bg-blue-500/20 border-blue-500/50'
  }[type];

  const textColor = {
    success: 'text-green-400',
    error: 'text-red-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400'
  }[type];

  const icon = {
    success: <CheckCircle className="w-5 h-5" />,
    error: <AlertCircle className="w-5 h-5" />,
    warning: <AlertCircle className="w-5 h-5" />,
    info: <AlertCircle className="w-5 h-5" />
  }[type];

  return (
    <div className={`fixed bottom-4 right-4 ${bgColor} border rounded-lg p-4 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300 max-w-sm z-50`}>
      <div className={textColor}>{icon}</div>
      <div className="flex-1">
        <p className={`${textColor} font-semibold text-sm`}>{message}</p>
      </div>
      <button
        onClick={() => {
          setIsVisible(false);
          onClose?.();
        }}
        className="text-gray-400 hover:text-gray-200"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default Toast;
