# OTP Verification - Quick Start Guide

## Setup Steps

### 1. Configure Environment Variables

Add these to your `.env` file or deployment environment:

```bash
MC_CUSTOMER_ID=C-6B2BB17B77EB486
MC_KEY=<your_base64_encoded_key>
MC_BASE_URL=https://cpaas.messagecentral.com
```

**Get your credentials from MessageCentral:**
1. Sign up at https://www.messagecentral.com/
2. Go to Dashboard → API Keys
3. Copy your Customer ID
4. Generate an API Key (may need to base64 encode it)

### 2. Update Database Schema

Run the schema migration:

```bash
# Using psql
psql -U your_user -d your_database -f backend/schema.sql

# Or using the init script
cd backend
python3 init_db.py
```

This creates the `otp_verifications` table.

### 3. Test the Integration

#### Send OTP
```bash
curl -X POST http://localhost:5000/api/otp/send \
  -H "Content-Type: application/json" \
  -d '{
    "mobile": "9876543210"
  }'
```

**Response:**
```json
{
  "status": "success",
  "verificationId": "abc123xyz456",
  "message": "OTP sent successfully"
}
```

#### Verify OTP
```bash
curl -X POST http://localhost:5000/api/otp/verify \
  -H "Content-Type: application/json" \
  -d '{
    "verificationId": "abc123xyz456",
    "otp": "123456"
  }'
```

**Response:**
```json
{
  "status": "verified",
  "message": "OTP verified successfully"
}
```

#### Check OTP Status
```bash
curl http://localhost:5000/api/otp/status/abc123xyz456
```

**Response:**
```json
{
  "verification_id": "abc123xyz456",
  "mobile": "9876543210",
  "otp_sent_at": "2024-01-01T00:00:00Z",
  "otp_verified_at": "2024-01-01T00:05:00Z",
  "status": "verified",
  "attempt_count": 1,
  "participant_id": null
}
```

## Frontend Integration Example

```javascript
// Send OTP
async function sendOTP(mobileNumber) {
  const response = await fetch('/api/otp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile: mobileNumber })
  });
  
  const data = await response.json();
  
  if (data.verificationId) {
    localStorage.setItem('otpVerificationId', data.verificationId);
    return true;
  }
  
  throw new Error(data.error || 'Failed to send OTP');
}

// Verify OTP
async function verifyOTP(otpCode) {
  const verificationId = localStorage.getItem('otpVerificationId');
  
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
    localStorage.removeItem('otpVerificationId');
    return true;
  }
  
  throw new Error(data.message || 'Invalid OTP');
}
```

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "MessageCentral credentials not configured" | Missing MC_KEY or MC_CUSTOMER_ID | Check environment variables |
| "Invalid Indian mobile number format" | Wrong mobile format | Must be 10 digits starting with 6-9 |
| "Too many OTP attempts" | Rate limit exceeded | Wait 10 minutes before retrying |
| "Invalid OTP format" | Wrong OTP format | Must be exactly 6 digits |
| "Failed to connect to MessageCentral" | Network or API issue | Check internet connection and MC_BASE_URL |

## Rate Limits

| Endpoint | Limit | Duration |
|----------|-------|----------|
| POST /otp/send | 5 requests | 10 minutes |
| POST /otp/verify | 10 requests | 1 minute |
| GET /otp/status/<id> | 20 requests | 1 minute |

## Security Notes

✅ **Implemented:**
- Token caching with auto-refresh
- Input validation (mobile & OTP format)
- Rate limiting (both Flask-Limiter and database-level)
- Audit logging for all OTP events
- IP address hashing

❌ **Never expose:**
- MC_KEY or MC_CUSTOMER_ID
- Auth tokens
- OTP codes
- Sensitive user data

## Monitoring

Check OTP events in the database:

```sql
-- Recent OTP sends
SELECT * FROM otp_verifications
ORDER BY created_at DESC
LIMIT 10;

-- Failed attempts
SELECT * FROM otp_verifications
WHERE verification_status = 'failed'
ORDER BY created_at DESC;

-- Audit log
SELECT * FROM audit_log
WHERE event_type LIKE 'otp%'
ORDER BY timestamp DESC
LIMIT 20;
```

## Troubleshooting

### OTP not received?
1. Check MessageCentral dashboard for delivery status
2. Verify mobile number format is correct
3. Ensure MC_KEY is properly base64 encoded
4. Check application logs for errors

### Verification fails?
1. Ensure you're using the correct verificationId
2. OTP codes are case-sensitive
3. OTP expires after a certain time (check MessageCentral docs)
4. Check audit_log for detailed error messages

### Rate limit errors?
1. Wait for the rate limit window to expire
2. Check if multiple users are sharing the same IP
3. Review abuse attempts in database

## Support Resources

- **Full Documentation:** `backend/OTP_INTEGRATION.md`
- **Implementation Summary:** `OTP_INTEGRATION_SUMMARY.md`
- **MessageCentral Docs:** https://developer.messagecentral.com/
- **Application Logs:** Check Flask app logs for detailed errors

## Testing Checklist

- [ ] Environment variables configured
- [ ] Database schema updated
- [ ] Send OTP endpoint working
- [ ] Verify OTP endpoint working
- [ ] Status check endpoint working
- [ ] Rate limiting functional
- [ ] Audit logs are created
- [ ] Error handling works correctly
- [ ] Mobile validation working
- [ ] Token caching working

---

**Need help?** Check `backend/OTP_INTEGRATION.md` for comprehensive documentation.
