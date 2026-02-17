# OTP Verification Integration - Implementation Summary

## Overview
Successfully integrated MessageCentral OTP verification system into the C.O.G.N.I.T. backend API.

## Files Modified

### 1. `backend/schema.sql`
**Changes:**
- Added `otp_verifications` table to track OTP attempts and verification status
- Added indexes for efficient querying of OTP records

**New Table:**
```sql
CREATE TABLE otp_verifications (
    id BIGSERIAL PRIMARY KEY,
    participant_fk BIGINT,
    participant_id VARCHAR(100),
    mobile VARCHAR(15) NOT NULL,
    verification_id VARCHAR(100),
    otp_sent_at TIMESTAMPTZ,
    otp_verified_at TIMESTAMPTZ,
    verification_status VARCHAR(50) DEFAULT 'pending',
    attempt_count INTEGER DEFAULT 0,
    ip_hash CHAR(64),
    user_agent VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

### 2. `backend/.env.example`
**Changes:**
- Added MessageCentral configuration section with:
  - `MC_CUSTOMER_ID`: MessageCentral customer ID
  - `MC_KEY`: Base64 encoded API key
  - `MC_BASE_URL`: MessageCentral API URL

### 3. `backend/app.py`
**Changes:**

#### Imports
- Added `requests` library import
- Added `timedelta` from datetime

#### Configuration
- Added MessageCentral environment variable loading
- Added token cache for MessageCentral auth tokens

#### New API Endpoints

1. **POST `/otp/send`** - Send OTP to mobile number
   - Rate limited: 5 per 10 minutes per IP
   - Validates Indian mobile number format
   - Tracks verification in database
   - Logs all OTP events

2. **POST `/otp/verify`** - Verify OTP code
   - Rate limited: 10 per minute per IP
   - Validates OTP format (6 digits)
   - Updates participant's phone number if linked
   - Logs verification attempts

3. **GET `/otp/status/<verification_id>`** - Get OTP verification status
   - Rate limited: 20 per minute per IP
   - Returns verification status and metadata

#### Updated Documentation
- Updated API documentation endpoints list
- Updated rate limiting documentation

### 4. `backend/otp_service.py` (NEW FILE)
**Purpose:** Handles MessageCentral API interactions

**Functions:**
- `get_mc_auth_token()`: Generates and caches MessageCentral auth tokens
- `validate_indian_mobile()`: Validates Indian mobile number format
- `send_otp()`: Sends OTP via MessageCentral API
- `verify_otp()`: Verifies OTP via MessageCentral API

**Features:**
- Token caching with 23-hour expiry
- Comprehensive error handling
- Request timeout handling

### 5. `backend/OTP_INTEGRATION.md` (NEW FILE)
**Purpose:** Comprehensive documentation for OTP integration

**Contents:**
- Architecture overview
- API endpoint documentation
- Database schema details
- Security features
- Integration guide with code examples
- Testing instructions
- Troubleshooting guide
- Monitoring queries
- Best practices
- Compliance notes

## Security Features Implemented

### 1. Token Caching
- MessageCentral auth tokens cached in memory
- Auto-regeneration after 23 hours
- Reduces API calls and improves performance

### 2. Rate Limiting
- **Send OTP:** 5 requests per 10 minutes per IP
- **Verify OTP:** 10 requests per minute per IP
- **Status Check:** 20 requests per minute per IP
- Additional database-level rate limiting (max 5 OTP sends per 10 minutes per mobile)

### 3. Input Validation
- Mobile number format validation (10 digits, starts with 6-9)
- OTP format validation (6 digits)
- Verification ID validation

### 4. Audit Logging
All OTP events logged to `audit_log` table:
- `otp_sent`: When OTP is sent
- `otp_verified`: When OTP is verified
- `otp_verification_failed`: When verification fails
- `otp_rate_limited`: When rate limit is exceeded

### 5. IP Hashing
- IP addresses stored as SHA-256 hashes
- Prevents IP tracking while maintaining security

## Environment Variables Required

```bash
# MessageCentral Configuration
MC_CUSTOMER_ID=C-6B2BB17B77EB486
MC_KEY=<base64_encoded_api_key>
MC_BASE_URL=https://cpaas.messagecentral.com
```

## Database Migration

Run the following to apply the schema changes:

```bash
# Apply schema changes
psql -U your_user -d your_database -f backend/schema.sql

# Or run the init_db.py script if available
cd backend
python3 init_db.py
```

## Testing

### Syntax Validation
```bash
cd backend
python3 -m py_compile app.py
python3 -m py_compile otp_service.py
```

### API Testing (with cURL)

#### Send OTP
```bash
curl -X POST http://localhost:5000/api/otp/send \
  -H "Content-Type: application/json" \
  -d '{"mobile": "9876543210"}'
```

#### Verify OTP
```bash
curl -X POST http://localhost:5000/api/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"verificationId": "abc123", "otp": "123456"}'
```

#### Get OTP Status
```bash
curl http://localhost:5000/api/otp/status/abc123
```

## API Endpoints Summary

| Endpoint | Method | Rate Limit | Description |
|----------|--------|------------|-------------|
| `/otp/send` | POST | 5/10min | Send OTP to mobile |
| `/otp/verify` | POST | 10/min | Verify OTP code |
| `/otp/status/<id>` | GET | 20/min | Get verification status |

## Next Steps for Deployment

1. **Configure MessageCentral Account**
   - Sign up at https://www.messagecentral.com/
   - Get customer ID and API key
   - Add credentials to environment variables

2. **Update Database**
   - Run schema migration to add `otp_verifications` table

3. **Test in Development**
   - Test with real mobile numbers
   - Verify rate limiting works
   - Check audit logs

4. **Deploy to Production**
   - Ensure HTTPS is enabled
   - Configure proper CORS origins
   - Monitor OTP usage and abuse

## Notes

- Token caching is in-memory and will reset on server restart
- For distributed deployments, consider Redis-based token caching
- MessageCentral credentials are never exposed in API responses or logs
- All mobile numbers are stored in the database for verification purposes
- IP addresses are hashed for privacy (same as other endpoints in the system)

## Compliance

- OTP verification logs are stored with IP hashes
- Mobile numbers stored for verification purposes
- Audit logs track all OTP events
- Ensure GDPR/privacy policy compliance for mobile data collection

## Support

For MessageCentral-specific issues, refer to:
- MessageCentral Documentation: https://developer.messagecentral.com/
- MessageCentral Support: Available via their dashboard

For C.O.G.N.I.T. integration issues:
- Check logs for detailed error messages
- Review OTP_INTEGRATION.md documentation
- Check audit_log table for verification events
