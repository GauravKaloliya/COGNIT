# Unified Error Handling System - Implementation Summary

## Overview

The COGNIT project now features a comprehensive, unified error handling system across backend, frontend, and database layers. This system provides standardized error codes, automatic translations, comprehensive error tracking, and user-friendly error messages with actionable guidance.

## System Architecture

### 1. Backend Layer (Python Flask)

#### Error Code Hierarchy
Error codes follow a structured format: `CATEGORY_SUBCATEGORY_SPECIFIC`
- **Categories:** VAL (Validation), DUP (Duplicate), AUTH (Authorization), NF (Not Found), PAY (Payment), FRAUD (Fraud Detection), SYS (System), RATE (Rate Limit)
- **Format:** XXX_YYY_ZZZZ (e.g., VAL_002_0004 = Validation/Content/Word Count Min)

#### Key Components

**1. Enhanced Error Response System**
- `error_response(error_key, **kwargs)` - Generate standardized error responses with message formatting
- `success_response(data, message)` - Generate standardized success responses
- `create_error_response()` - Legacy wrapper for backward compatibility

**2. Error Logging**
- `@log_errors` decorator - Automatically logs all exceptions to database
- `/client-errors` endpoint - Receives client-side errors for analysis
- Comprehensive error tracking with stack traces, IP hashing, and participant IDs

**3. Database Error Mapping**
- `handle_db_error(exc)` - Maps database exceptions to appropriate error codes
- Handles unique constraint violations, check constraints, and foreign key errors

**4. Error Response Format**
```json
{
  "success": false,
  "error": {
    "code": "VAL_002_0004",
    "message": "At least 60 words required (you wrote 23)",
    "category": "VAL",
    "field": "description"
  }
}
```

### 2. Database Layer (PostgreSQL)

#### Error Logging Table
```sql
CREATE TABLE error_log (
    id              BIGSERIAL PRIMARY KEY,
    error_code      VARCHAR(20) NOT NULL,
    error_message   TEXT,
    error_type      VARCHAR(100),
    endpoint        VARCHAR(120),
    http_method     VARCHAR(10),
    status_code     SMALLINT,
    ip_hash         CHAR(64),
    user_agent      VARCHAR(512),
    stack_trace     TEXT,
    participant_id  BIGINT REFERENCES participants(id) ON DELETE SET NULL,
    request_data    JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

#### Analytics View
- `error_analytics` materialized view for dashboard monitoring
- Aggregates errors by code and hour for trend analysis
- Tracks unique users affected by each error

#### Indexes
- Performance indexes on created_at, error_code, participant_id, and endpoint
- Optimized for both real-time monitoring and historical analysis

### 3. Frontend Layer (React)

#### Error Registry (`errorRegistry.js`)
- **Translation System:** Supports multiple languages (English, Hindi implemented)
- **Error Mapping:** Maps backend error codes to user-friendly messages
- **Template Support:** Message variables like `{actual}`, `{min_words}`
- **Categorization:** Each error has severity (error/warning/info) and action type

#### Enhanced API Wrapper (`api.js`)
- **Automatic Error Parsing:** Converts API responses to standardized format
- **Error Logging:** Sends client errors to backend for analytics
- **Action Guidance:** Provides suggested user actions based on error category
- **Backward Compatibility:** Works with existing error handling

#### Error Toast Component (`ErrorToast.jsx`)
- **Severity-based Styling:** Different colors for error, warning, and info
- **Action Buttons:** Context-aware buttons (Try Again, Fix, Change, etc.)
- **Auto-dismiss:** Configurable timeout for error notifications
- **Field-specific Errors:** Highlights problematic form fields

#### Error Categories and Actions

| Category | Severity | Action | User Guidance |
|----------|----------|--------|---------------|
| VAL | warning | fix_input | Highlight and explain field errors |
| DUP | warning | change_input | Suggest different values |
| AUTH | error | reauthenticate | Redirect to login/consent |
| NF | error | redirect | Navigate to appropriate page |
| PAY | warning | retry_payment | Restart payment flow |
| FRAUD | error | retry_payment | Explain screenshot requirements |
| SYS | error | retry | Offer retry option |
| RATE | warning | wait | Show countdown timer |

## Key Features

### 1. Standardized Error Codes
- **Hierarchical Structure:** Easy to categorize and remember
- **Backward Compatible:** Legacy codes still work
- **Machine Readable:** Consistent format for automation

### 2. Multi-language Support
- **English (en):** Full translation set
- **Hindi (hi):** Key error translations
- **Extensible:** Easy to add more languages
- **Template Variables:** Dynamic content in multiple languages

### 3. Comprehensive Tracking
- **Backend Logging:** All exceptions logged with context
- **Client Logging:** Frontend errors sent to backend
- **Analytics Dashboard:** Error trends and impact analysis
- **Real-time Monitoring:** Track error rates and patterns

### 4. User Experience
- **Actionable Errors:** Every error suggests next steps
- **Field-level Guidance:** Specific errors for form fields
- **Contextual Actions:** Different actions based on error type
- **Progressive Enhancement:** Works with existing error handling

### 5. Developer Experience
- **Type Safety:** Structured error objects
- **Easy Integration:** Simple API for error handling
- **Documentation Generator:** Auto-generates API docs
- **Backward Compatible:** No breaking changes

## Implementation Files

### Backend Files
- `backend/app.py` - Enhanced error handling functions and routes
- `backend/schema.sql` - Error logging table and analytics view
- `backend/generate_error_docs.py` - Documentation generator

### Frontend Files
- `frontend/src/utils/errorRegistry.js` - Centralized error registry with translations
- `frontend/src/utils/api.js` - Enhanced API wrapper with error handling
- `frontend/src/components/ErrorToast.jsx` - Error display component with actions
- `frontend/src/utils/errors.js` - Backward compatibility wrapper

## Usage Examples

### Backend Error Response
```python
# Simple error
return error_response("DUP_USERNAME")

# Error with formatting
return error_response("VAL_WORD_COUNT_MIN", 
                     min_words=MIN_WORD_COUNT, 
                     actual=word_count)

# Success response
return success_response(data={"id": 123}, message="Created successfully")
```

### Frontend Error Handling
```javascript
import { api, parseErrorResponse } from './utils/api';

// Using the enhanced API
try {
  const response = await api.post('/submit', data);
  // Handle success
} catch (error) {
  const parsedError = parseErrorResponse(error);
  
  // Show field-specific error
  if (parsedError.field) {
    showFieldError(parsedError.field, parsedError.message);
  }
  
  // Handle by action type
  switch (parsedError.action) {
    case 'retry':
      showRetryButton();
      break;
    case 'fix_input':
      highlightField(parsedError.field);
      break;
  }
}
```

### Error Logging
```javascript
import { logErrorToBackend } from './utils/errorRegistry';

// Log client error
logErrorToBackend({
  code: 'VAL_002_0004',
  message: 'At least 60 words required',
  category: 'VAL',
  severity: 'warning'
});
```

## Migration Guide

### For Backend Developers
1. Use `error_response()` for new code instead of `jsonify({"error": "..."})`
2. Add `@log_errors` decorator to all route handlers
3. Use `success_response()` for consistent success formatting
4. Map database errors using `handle_db_error()`

### For Frontend Developers
1. Import from `errorRegistry.js` for new error handling
2. Use `api.js` instead of raw fetch for better error handling
3. Handle errors by action type: `error.action`
4. Use `ErrorToast` component for consistent UI

### For Database Administrators
1. Run schema updates to add `error_log` table
2. Set up materialized view refresh schedule
3. Monitor error patterns in `error_analytics` view
4. Review high-frequency errors for system improvements

## Monitoring and Analytics

### Real-time Monitoring
```sql
-- Check error rates by code
SELECT error_code, COUNT(*) as occurrences
FROM error_log 
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY error_code
ORDER BY occurrences DESC;

-- Track unique users affected
SELECT error_code, COUNT(DISTINCT participant_id) as users_affected
FROM error_log
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY error_code
ORDER BY users_affected DESC;
```

### Dashboard Metrics
- Error rate trends (errors per hour)
- User impact (unique users affected)
- Error distribution by category
- Response time correlation
- Geographic error patterns (via IP hashing)

## Best Practices

### Error Message Guidelines
1. **Be Specific:** Explain exactly what's wrong
2. **Be Actionable:** Tell users what to do next
3. **Be Consistent:** Use same terminology across system
4. **Be Localized:** Provide translations for key markets
5. **Avoid Technical Details:** Don't expose internals to users

### Error Handling Patterns
1. **Validate Early:** Catch errors at input boundaries
2. **Log Comprehensively:** Include context for debugging
3. **Handle Gracefully:** Provide fallback responses
4. **Monitor Proactively:** Track error rates and patterns
5. **Respond Quickly:** Return errors in <100ms

### Security Considerations
1. **Sanitize Error Messages:** Don't leak sensitive data
2. **Hash IPs:** Protect user privacy in logs
3. **Limit Stack Traces:** Only in debug mode
4. **Rate Limit Logging:** Prevent log flooding
5. **Secure Error Endpoints:** Authenticate sensitive operations

## Future Enhancements

### Planned Features
1. **Error Correlation:** Link related errors across user sessions
2. **Smart Retry:** Automatic retry with exponential backoff
3. **A/B Testing:** Test different error messages
4. **Machine Learning:** Predict and prevent common errors
5. **Custom Dashboards:** Build error monitoring UIs

### Integration Opportunities
1. **External Monitoring:** Send errors to Sentry, DataDog
2. **Alerting:** Slack/email notifications for critical errors
3. **Incident Response:** Auto-create tickets for high-severity errors
4. **Performance Monitoring:** Correlate errors with performance metrics

## Support and Documentation

### Generated Documentation
- **Error Reference:** `ERROR_REFERENCE.md` (auto-generated)
- **API Docs:** `/docs` endpoint includes error codes
- **Code Comments:** All functions documented with JSDoc
- **Type Definitions:** JSDoc types for better IDE support

### Getting Help
1. Check error codes in `ERROR_REFERENCE.md`
2. Review error patterns in database
3. Use developer tools to see client-side errors
4. Check logs for detailed error context

---

## Summary

The unified error handling system provides:

✅ **Standardized error codes** with hierarchical structure  
✅ **Multi-language support** with auto-translations  
✅ **Comprehensive tracking** across all system layers  
✅ **User-friendly messages** with actionable guidance  
✅ **Developer-friendly APIs** with type safety  
✅ **Backward compatibility** with existing code  
✅ **Real-time monitoring** and analytics  
✅ **Security-first design** with privacy protection  

This system ensures consistent, informative, and actionable error handling across the entire COGNIT application, improving both user experience and developer productivity.