# C.O.G.N.I.T. Payment System v2.0 - Redesign Documentation

## Overview

The payment system has been completely redesigned to:
- ✅ Remove Razorpay integration
- ✅ Use AWS S3 for all image storage (payment proofs + survey images)
- ✅ Implement automatic payment verification
- ✅ No admin verification required
- ✅ Secured payment routes

## Changes Summary

### 1. New Database Schema

#### Payments Table (Enhanced)
```sql
- payment_reference VARCHAR(100) UNIQUE NOT NULL  -- Now required
- utr_number VARCHAR(100)                         -- UTR from payment
- utr_extracted VARCHAR(100)                      -- OCR extracted UTR
- utr_verified BOOLEAN DEFAULT FALSE              -- Verification status
- ocr_confidence FLOAT DEFAULT 0.0                -- OCR confidence
- screenshot_url TEXT                            -- AWS S3 URL
- screenshot_hash VARCHAR(64)                    -- File hash
- s3_key VARCHAR(500)                            -- AWS S3 key
- auto_verified BOOLEAN DEFAULT FALSE            -- Auto verification flag
- verification_method VARCHAR(50)                -- 'automatic' or 'manual'
- verification_timestamp TIMESTAMPTZ             -- When verified
- verification_details TEXT                     -- JSON with verification info
- status VARCHAR(50) DEFAULT 'pending'           -- pending/submitted/verified/failed
- failed_at TIMESTAMPTZ                         -- When payment failed
```

#### New: UPI Transactions Table
```sql
CREATE TABLE upi_transactions (
    id BIGINT PRIMARY KEY,
    utr_number VARCHAR(100) UNIQUE NOT NULL,
    payment_reference VARCHAR(100),
    amount INTEGER NOT NULL,
    payee_vpa VARCHAR(255),
    payer_vpa VARCHAR(255),
    transaction_timestamp TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL,
    bank_reference VARCHAR(255),
    raw_data JSONB,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

#### Images Table (AWS S3)
```sql
ALTER TABLE images ADD COLUMN s3_key VARCHAR(500);
ALTER TABLE images ADD COLUMN s3_url TEXT;
ALTER TABLE images ADD COLUMN content_type VARCHAR(50) DEFAULT 'image/svg+xml';
```

### 2. Payment Routes (Redesigned)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/payment/upi-details` | POST | Get UPI payment details with QR code |
| `/payment/submit` | POST | Submit payment proof with automatic verification |
| `/payment/status/<participant_id>` | GET | Get payment status |
| `/payment/verify-automatic` | POST | Trigger automatic verification (for cron) |
| `/survey/images` | GET | Get survey images from AWS S3 |
| `/survey/images/attention` | GET | Get attention check images |

### 3. Key Features

#### Automatic Payment Verification
- OCR extracts UTR from payment screenshot
- External API verifies transaction (if configured)
- Automatic status updates
- Manual review fallback if verification fails

#### AWS S3 Integration
- All payment screenshots stored in S3
- Survey images loaded from S3
- Presigned URLs for secure access
- Automatic content type detection

#### Security
- Rate limiting on all endpoints
- Input validation and sanitization
- Audit logging for all payment events
- Secure file upload validation

### 4. Removed Features

- ❌ Razorpay integration (completely removed)
- ❌ Admin verification endpoint (`/payment/verify-admin`)
- ❌ Manual UTR entry required (optional now)
- ❌ Local image storage

### 5. Environment Variables (v2.0)

```bash
# Required
DATABASE_URL=postgresql://...
UPI_ID=yourname@upi
UPI_PAYEE_NAME=Your Name
PAYMENT_AMOUNT=100

# AWS S3 (Required)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket
S3_IMAGES_PREFIX=survey-images/
S3_PAYMENT_PROOFS_PREFIX=payment-proofs/

# Optional: Automatic Verification
UPI_VERIFICATION_API_URL=https://api.example.com/verify
UPI_VERIFICATION_API_KEY=your-api-key
```

### 6. Migration Guide

#### Step 1: Run Migration Script
```bash
cd backend
python migrate_to_v2.py
```

#### Step 2: Update Environment Variables
Copy new variables from `.env.example`

#### Step 3: Switch to New App
Replace `app.py` with `app_v2.py` (or rename)

#### Step 4: Configure AWS S3
1. Create S3 bucket
2. Set up IAM user with S3 permissions
3. Configure bucket policy for public read (or use presigned URLs)

#### Step 5: Test Payment Flow
1. Create test participant
2. Get UPI details
3. Submit payment proof
4. Verify automatic status update

### 7. API Response Examples

#### Get UPI Details
```json
{
  "upi_id": "yourname@upi",
  "payee_name": "Your Name",
  "amount": 100,
  "amount_display": "₹1.00",
  "payment_reference": "COGNIT_ABC123DEF456",
  "qr_url": "upi://pay?pa=yourname@upi&pn=Your+Name&am=1.00&tn=COGNIT_ABC123DEF456&cu=INR",
  "instructions": [
    "Open your UPI app (GPay, PhonePe, Paytm, etc.)",
    "Send ₹1 to: yourname@upi",
    "Add reference: COGNIT_ABC123DEF456",
    "Take a screenshot of the payment success screen",
    "Upload the screenshot below for automatic verification"
  ],
  "verification_note": "Payment will be automatically verified within 5 minutes"
}
```

#### Submit Payment (Verified)
```json
{
  "status": "verified",
  "message": "Payment verified successfully! You can now proceed to the survey.",
  "utr": "123456789012",
  "payment_reference": "COGNIT_ABC123DEF456",
  "verified_at": "2026-02-19T14:30:00",
  "next_step": "You can now start the survey"
}
```

#### Submit Payment (Pending)
```json
{
  "status": "submitted",
  "message": "Payment proof submitted for review.",
  "utr": "123456789012",
  "ocr_confidence": 0.85,
  "payment_reference": "COGNIT_ABC123DEF456",
  "verification_details": "Transaction not found in verification system",
  "requires_review": true
}
```

### 8. Files Changed

| File | Action |
|------|--------|
| `app_v2.py` | New - Complete redesigned application |
| `schema_v2.sql` | New - New database schema |
| `migrate_to_v2.py` | New - Migration script |
| `.env.example` | Updated - New environment variables |
| `schema.sql` | Deprecated - Old schema |
| `DATABASE_FIX.md` | Deprecated - Old fix documentation |
| `fix_payment_reference_column.sql` | Deprecated - Old fix |

### 9. Troubleshooting

#### Payment Not Being Verified
1. Check UPI verification API is configured
2. Verify OCR is extracting UTR correctly
3. Check UTR format (12-16 digits)
4. Review verification_details in response

#### S3 Upload Failing
1. Verify AWS credentials are correct
2. Check S3 bucket exists and is accessible
3. Ensure proper IAM permissions
4. Check bucket policy allows writes

#### Images Not Loading
1. Verify S3 bucket has public read access
2. Check S3_IMAGES_PREFIX is correct
3. Ensure images table has s3_url populated

### 10. Security Considerations

1. **Rate Limiting**: All payment endpoints have rate limits
2. **Input Validation**: All inputs are validated and sanitized
3. **File Validation**: Only allow safe image types (png, jpg, webp)
4. **Audit Logging**: All payment events are logged
5. **Hash Verification**: Payment screenshots are hashed for integrity

## Support

For issues or questions:
- Check audit logs: `SELECT * FROM audit_log WHERE event_type LIKE '%payment%';`
- Check payment status: `SELECT * FROM payments WHERE participant_id = '...';`
- Check verification details: `SELECT verification_details FROM payments WHERE ...;`