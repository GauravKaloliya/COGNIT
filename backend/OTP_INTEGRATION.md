# OTP Verification Integration

## Overview
This document describes the OTP (One-Time Password) verification system integrated into C.O.G.N.I.T. using MessageCentral's API.

## Architecture

### Components
1. **OTP Service Module** (`backend/otp_service.py`): Handles MessageCentral API interactions
2. **API Endpoints** (`backend/app.py`): Flask endpoints for OTP operations
3. **Database Schema** (`backend/schema.sql`): Stores OTP verification records
4. **Token Caching**: In-memory caching of MessageCentral auth tokens

### MessageCentral Configuration

#### Environment Variables
```bash
# MessageCentral OTP Configuration
MC_CUSTOMER_ID=C-6B2BB17B77EB486  # Your customer ID from MessageCentral
MC_KEY=<base64_encoded_key>        # Your API key (base64 encoded)
MC_BASE_URL=https://cpaas.messagecentral.com  # Default: MessageCentral API URL
```

#### Setup Instructions
1. Sign up at [MessageCentral](https://www.messagecentral.com/)
2. Get your Customer ID and API Key from the dashboard
3. Base64 encode your API key if required (check MessageCentral docs)
4. Add the above environment variables to your `.env` file or deployment environment

## API Endpoints

### 1. Send OTP
**Endpoint:** `POST /otp/send`

**Description:** Sends a 6-digit OTP to an Indian mobile number.

**Request Body:**
```json
{
  "mobile": "9876543210",
  "participant_id": "optional_participant_id"
}
```

**Parameters:**
- `mobile` (required): 10-digit Indian mobile number starting with 6-9
- `participant_id` (optional): Link OTP to a participant record

**Response (Success):**
```json
{
  "status": "success",
  "verificationId": "abc123xyz456",
  "message": "OTP sent successfully"
}
```

**Response (Error):**
```json
{
  "error": "Invalid Indian mobile number format. Must be 10 digits starting with 6-9"
}
```

**Rate Limiting:** 5 requests per 10 minutes per IP

**Validation:**
- Mobile must be 10 digits
- Must start with 6-9 (Indian mobile format)
- Prevents abuse by checking recent attempts in database

---

### 2. Verify OTP
**Endpoint:** `POST /otp/verify`

**Description:** Verifies an OTP code using the verification ID.

**Request Body:**
```json
{
  "verificationId": "abc123xyz456",
  "otp": "123456",
  "mobile": "9876543210",
  "participant_id": "optional_participant_id"
}
```

**Parameters:**
- `verificationId` (required): Verification ID from `/otp/send` response
- `otp` (required): 6-digit OTP code
- `mobile` (optional): Mobile number for validation
- `participant_id` (optional): Link verification to a participant

**Response (Success):**
```json
{
  "status": "verified",
  "message": "OTP verified successfully"
}
```

**Response (Error):**
```json
{
  "status": "failed",
  "message": "Invalid OTP code. Please try again."
}
```

**Rate Limiting:** 10 requests per minute per IP

**Side Effects:**
- Updates `otp_verifications` table with verification status
- If `participant_id` is provided, updates participant's phone number
- Logs verification attempt to audit log

---

### 3. Get OTP Status
**Endpoint:** `GET /otp/status/<verification_id>`

**Description:** Retrieves the status of an OTP verification.

**Path Parameters:**
- `verification_id`: The verification ID from `/otp/send` response

**Response (Success):**
```json
{
  "verification_id": "abc123xyz456",
  "mobile": "9876543210",
  "otp_sent_at": "2024-01-01T00:00:00Z",
  "otp_verified_at": "2024-01-01T00:05:00Z",
  "status": "verified",
  "attempt_count": 1,
  "participant_id": "participant_123"
}
```

**Response (Error):**
```json
{
  "error": "Verification ID not found"
}
```

**Rate Limiting:** 20 requests per minute per IP

---

## Database Schema

### `otp_verifications` Table
```sql
CREATE TABLE otp_verifications (
    id BIGSERIAL PRIMARY KEY,
    participant_fk BIGINT,                    -- Foreign key to participants (optional)
    participant_id VARCHAR(100),               -- Participant ID (optional)
    mobile VARCHAR(15) NOT NULL,               -- Mobile number (with country code)
    verification_id VARCHAR(100),              -- MessageCentral verification ID
    otp_sent_at TIMESTAMPTZ,                   -- When OTP was sent
    otp_verified_at TIMESTAMPTZ,               -- When OTP was verified
    verification_status VARCHAR(50) DEFAULT 'pending',  -- pending, verified, failed, expired
    attempt_count INTEGER DEFAULT 0,            -- Number of verification attempts
    ip_hash CHAR(64),                          -- Hashed IP address
    user_agent VARCHAR(500),                   -- User agent string
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

### Indexes
- `idx_otp_participant_fk`: For participant lookups
- `idx_otp_mobile`: For mobile number queries
- `idx_otp_verification_id`: For verification ID lookups
- `idx_otp_status`: For status filtering
- `idx_otp_created_at`: For time-based queries

---

## Security Features

### 1. Token Caching
- MessageCentral auth tokens are cached in memory
- Tokens expire after 23 hours (safe buffer before 24-hour expiry)
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
- All OTP events are logged to `audit_log` table:
  - `otp_sent`: When OTP is sent
  - `otp_verified`: When OTP is verified
  - `otp_verification_failed`: When verification fails
  - `otp_rate_limited`: When rate limit is exceeded

### 5. IP Hashing
- IP addresses are stored as SHA-256 hashes (same as other endpoints)
- Prevents IP tracking while maintaining security

---

## Integration Guide

### Frontend Integration Example

```javascript
// Step 1: Send OTP
async function sendOTP(mobile, participantId = null) {
  const response = await fetch('/api/otp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mobile: mobile,
      participant_id: participantId
    })
  });
  
  const data = await response.json();
  if (data.verificationId) {
    // Store verificationId for verification step
    localStorage.setItem('otpVerificationId', data.verificationId);
    return data;
  }
  throw new Error(data.error || 'Failed to send OTP');
}

// Step 2: Verify OTP
async function verifyOTP(otpCode) {
  const verificationId = localStorage.getItem('otpVerificationId');
  if (!verificationId) {
    throw new Error('No verification ID found. Please request OTP first.');
  }

  const response = await fetch('/api/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      verificationId: verificationId,
      otp: otpCode
    })
  });
  
  const data = await response.json();
  if (data.status === 'verified') {
    // Clear verification ID after successful verification
    localStorage.removeItem('otpVerificationId');
    return data;
  }
  throw new Error(data.message || 'Failed to verify OTP');
}

// Step 3: Check OTP Status (optional)
async function getOTPStatus(verificationId) {
  const response = await fetch(`/api/otp/status/${verificationId}`);
  return await response.json();
}
```

---

## Testing

### Using cURL

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
  -d '{"verificationId": "abc123xyz456", "otp": "123456"}'
```

#### Get OTP Status
```bash
curl http://localhost:5000/api/otp/status/abc123xyz456
```

---

## Troubleshooting

### Common Issues

1. **"MessageCentral credentials not configured"**
   - Ensure `MC_CUSTOMER_ID` and `MC_KEY` environment variables are set
   - Check that values are not empty or malformed

2. **"Invalid Indian mobile number format"**
   - Mobile must be 10 digits starting with 6-9
   - Don't include country code (91) in the request

3. **"Too many OTP attempts"**
   - Wait 10 minutes before trying again
   - Rate limit is enforced per mobile number

4. **"Failed to connect to MessageCentral"**
   - Check internet connectivity
   - Verify `MC_BASE_URL` is correct
   - Check MessageCentral service status

### Logs
Check application logs for detailed error messages:
```bash
# Production
tail -f /var/log/cognit/app.log

# Local development
# Logs are printed to console
```

---

## Monitoring

### Key Metrics to Track
1. **OTP Send Success Rate:** Percentage of successful OTP sends
2. **OTP Verification Success Rate:** Percentage of successful verifications
3. **Average Verification Time:** Time between OTP send and verify
4. **Rate Limit Hits:** Number of rate limit violations
5. **Failed Attempts:** Number of failed OTP attempts

### Database Queries for Monitoring

```sql
-- OTP send success rate
SELECT
  COUNT(*) FILTER (WHERE verification_status = 'verified') * 100.0 / COUNT(*) as success_rate,
  COUNT(*) as total_attempts
FROM otp_verifications
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Average verification time
SELECT
  AVG(EXTRACT(EPOCH FROM (otp_verified_at - otp_sent_at))) as avg_seconds
FROM otp_verifications
WHERE otp_verified_at IS NOT NULL
  AND created_at > NOW() - INTERVAL '24 hours';

-- Failed attempts by mobile
SELECT
  mobile,
  COUNT(*) FILTER (WHERE verification_status = 'failed') as failed_count
FROM otp_verifications
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY mobile
HAVING COUNT(*) FILTER (WHERE verification_status = 'failed') > 3
ORDER BY failed_count DESC;

-- Rate limit violations
SELECT COUNT(*) as rate_limit_hits
FROM audit_log
WHERE event_type = 'otp_rate_limited'
  AND timestamp > NOW() - INTERVAL '24 hours';
```

---

## Best Practices

1. **Always validate mobile numbers** before sending OTP
2. **Implement retry logic** for transient failures
3. **Cache verification IDs** securely (use HTTP-only cookies or secure storage)
4. **Display clear error messages** to users
5. **Monitor rate limit violations** to detect abuse
6. **Regularly review audit logs** for suspicious activity
7. **Set up alerts** for high failure rates or abuse patterns
8. **Use HTTPS only** in production
9. **Never log or expose** OTP codes or API keys
10. **Keep MessageCentral credentials** secure and rotate regularly

---

## Compliance Notes

- OTP verification logs are stored in the database with IP hashes
- Mobile numbers are stored in plaintext for verification purposes
- Audit logs track all OTP events for compliance
- Data retention policies should be configured per requirements
- Ensure GDPR/privacy policy compliance for mobile data collection

---

## Support

For issues related to:
- **MessageCentral API:** Contact MessageCentral support
- **C.O.G.N.I.T. integration:** Check logs, review this documentation, or open an issue
- **Billing/account:** MessageCentral dashboard

---

## License

This integration is part of C.O.G.N.I.T. and follows the same license.
