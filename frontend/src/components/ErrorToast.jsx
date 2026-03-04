import React from 'react';

/**
 * Error Toast Component with Action Buttons
 * Displays errors with appropriate user actions based on error category
 */
export default function ErrorToast({ 
  error, 
  onDismiss, 
  onAction,
  onRetry,
  onRedirect,
  onWait,
  showCode = false
}) {
  if (!error) return null;
  
  // Define action handlers based on error action
  const actions = {
    retry: { 
      label: 'Try Again', 
      handler: () => {
        if (onRetry) onRetry();
        else onDismiss();
      }
    },
    retry_payment: { 
      label: 'New Payment', 
      handler: () => {
        if (onAction) onAction('payment');
        else onDismiss();
      }
    },
    fix_input: { 
      label: 'Fix', 
      handler: () => {
        if (onAction) onAction('fix');
        else onDismiss();
      }
    },
    change_input: { 
      label: 'Change', 
      handler: () => {
        if (onAction) onAction('change');
        else onDismiss();
      }
    },
    reauthenticate: { 
      label: 'Sign In', 
      handler: () => {
        if (onRedirect) onRedirect('/');
        else window.location.href = '/';
      }
    },
    redirect: { 
      label: 'Go Back', 
      handler: () => {
        if (onRedirect) onRedirect(-1);
        else window.history.back();
      }
    },
    wait: { 
      label: 'OK', 
      handler: () => {
        if (onWait) onWait();
        else onDismiss();
      }
    },
  };
  
  // Select appropriate action button
  const action = actions[error.action] || actions.wait;
  
  // Get severity styling
  const severityStyles = {
    error: {
      container: 'bg-red-50 border-red-200 text-red-800',
      icon: 'text-red-600',
      button: 'bg-red-600 hover:bg-red-700 text-white',
      dismissButton: 'text-red-600 hover:text-red-800'
    },
    warning: {
      container: 'bg-yellow-50 border-yellow-200 text-yellow-800',
      icon: 'text-yellow-600',
      button: 'bg-yellow-600 hover:bg-yellow-700 text-white',
      dismissButton: 'text-yellow-600 hover:text-yellow-800'
    },
    info: {
      container: 'bg-blue-50 border-blue-200 text-blue-800',
      icon: 'text-blue-600',
      button: 'bg-blue-600 hover:bg-blue-700 text-white',
      dismissButton: 'text-blue-600 hover:text-blue-800'
    }
  };
  
  const style = severityStyles[error.severity] || severityStyles.error;
  
  return (
    <div className={`toast fixed top-4 right-4 max-w-md rounded-lg border p-4 shadow-lg z-50 ${style.container}`}>
      <div className="flex items-start">
        {/* Error Icon */}
        <div className={`flex-shrink-0 mr-3 ${style.icon}`}>
          {error.severity === 'error' && (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          )}
          {error.severity === 'warning' && (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          )}
          {error.severity === 'info' && (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          )}
        </div>
        
        {/* Error Content */}
        <div className="flex-1">
          {/* Error Code (optional) */}
          {showCode && error.code && (
            <div className="text-xs font-mono opacity-75 mb-1">
              {error.code}
            </div>
          )}
          
          {/* Error Message */}
          <div className="text-sm font-medium mb-3">
            {error.message}
          </div>
          
          {/* Error Details (if available) */}
          {error.details && typeof error.details === 'string' && (
            <div className="text-xs opacity-75 mb-3">
              {error.details}
            </div>
          )}
          
          {/* Action Buttons */}
          <div className="flex space-x-2">
            <button
              onClick={action.handler}
              className={`inline-flex items-center px-3 py-1.5 rounded text-xs font-medium ${style.button}`}
            >
              {action.label}
            </button>
            
            <button
              onClick={onDismiss}
              className={`inline-flex items-center px-3 py-1.5 rounded text-xs font-medium border ${style.dismissButton}`}
            >
              Dismiss
            </button>
          </div>
        </div>
        
        {/* Dismiss Button (X) */}
        <button
          onClick={onDismiss}
          className={`flex-shrink-0 ml-3 ${style.dismissButton}`}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Hook for managing error toasts
 */
export function useErrorToast() {
  const [errors, setErrors] = React.useState([]);

  const dismissError = React.useCallback((errorId) => {
    setErrors(prev => prev.filter(error => error.id !== errorId));
  }, []);
  
  const showError = React.useCallback((error, options = {}) => {
    const errorWithId = {
      ...error,
      id: Date.now() + Math.random(),
      timestamp: new Date().toISOString()
    };
    
    setErrors(prev => [...prev, errorWithId]);
    
    // Auto-dismiss after timeout if specified
    if (options.timeout) {
      setTimeout(() => {
        dismissError(errorWithId.id);
      }, options.timeout);
    }
    
    return errorWithId.id;
  }, [dismissError]);
  
  const clearAllErrors = React.useCallback(() => {
    setErrors([]);
  }, []);
  
  const dismissLatest = React.useCallback(() => {
    setErrors(prev => prev.slice(0, -1));
  }, []);
  
  return {
    errors,
    showError,
    dismissError,
    clearAllErrors,
    dismissLatest
  };
}
