# Payment System Implementation Summary

## Overview

This implementation adds a complete UPI payment system with OCR-based fraud detection to the C.O.G.N.I.T. platform. The system allows participants to upload payment proofs (screenshots of UPI transactions), which are automatically verified using Tesseract OCR and scored for potential fraud.

## Changes Made

### 1. Database Schema (`schema.sql`)

**New Tables Added:**
- `payments` - Enhanced payment tracking with UPI fields and fraud detection
- `payment_files` - S3-backed payment proof file storage
- `payment_submissions` - Links payments to survey submissions
- `payment_fraud_signals` - Individual fraud detection signals

**New Functions:**
- `sync_participant_payment_status()` - Auto-syncs payment status to participants table
- `reject_expired_pending_payments()` - Auto-rejects expired pending payments

**Updated Tables:**
- `payments` table now includes:
  - UPI-specific fields (upi_vpa, upi_note, upi_txn_ref)
  - OCR fields (extracted_text, fraud_score, verification_attempts)
  - Signature verification (signature, expires_at)
  - Additional status values (processing, rejected_fraud, expired)

### 2. Backend Application (`app.py`)

**New Imports:**
```python
urllib.parse, hmac, BytesIO, base64
datetime (datetime, timedelta, timezone)
qrcode, pytesseract, cv2, numpy, boto3
```

**New Configuration Variables:**
```python
UPI_VPA, UPI_NAME                    # UPI payment details
PAYMENT_SECRET, PAYMENT_EXPIRY_SECONDS  # Payment security
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET  # S3 setup
```

**New Helper Functions:**

1. `generate_payment_signature()` - Creates HMAC-SHA256 signature for payments
2. `generate_upi_link()` - Generates UPI deep link with QR code support
3. `fetch_s3_image()` - Retrieves payment proof images from S3
4. `extract_text_from_image()` - Extracts text using Tesseract OCR
5. `extract_upi_ref()` - Extracts UPI transaction reference (12-16 digit number)
6. `compute_fraud_score()` - Calculates fraud score based on extracted text

**New API Endpoints:**

#### POST `/payments/create`
Creates a new payment and returns UPI deep link + QR code

**Request:**
```json
{
  "public_id": "uuid",
  "amount": 100.00
}
```

**Response:**
```json
{
  "payment_id": "uuid",
  "amount": 100.00,
  "expires_at": "2024-01-01T12:00:00Z",
  "signature": "sha256-hash",
  "upi_link": "upi://pay?...",
  "qr_base64": "base64-encoded-qr"
}
```

#### POST `/payments/<payment_public_id>/upload-url`
Generates presigned S3 URL for uploading payment proof

**Response:**
```json
{
  "upload_url": "https://s3...",
  "object_key": "payments/uuid.jpg"
}
```

#### POST `/payments/<payment_public_id>/finalize`
Finalizes upload and stores file metadata (SHA256 hash)

**Request:**
```json
{
  "object_key": "payments/uuid.jpg",
  "sha256": "64-char-hex-string"
}
```

#### POST `/internal/payments/<payment_public_id>/verify`
Verifies payment using OCR and fraud detection (internal use)

**Response:**
```json
{
  "status": "verified",
  "fraud_score": 10.5,
  "upi_reference": "123456789012"
}
```

### 3. Dependencies (`requirements.txt`)

**New Packages Added:**
- `pillow==10.3.0` - Image processing
- `pytesseract==0.3.10` - OCR functionality
- `qrcode==7.4.2` - QR code generation
- `opencv-python==4.9.0.80` - Computer vision / image manipulation
- `boto3==1.34.93` - AWS S3 integration
- `celery==5.3.6` - Async task processing (for future use)

**System Dependency:**
- Tesseract OCR (install separately)

### 4. Environment Configuration (`.env.example`)

**New Environment Variables:**
```bash
# UPI Configuration
UPI_VPA=yourvpa@upi
UPI_NAME=YourBusinessName

# Payment Security
PAYMENT_SECRET=generate-with-openssl-rand-hex-32
PAYMENT_EXPIRY_SECONDS=900

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_REGION=ap-south-1
S3_BUCKET=cognitapi
```

## Fraud Detection Algorithm

The OCR-based fraud detection assigns points based on:

| Risk Factor | Score | Description |
|------------|-------|-------------|
| Missing amount | +30 | Expected amount not found in extracted text |
| "failed" keyword | +40 | Screenshot shows failed transaction |
| "pending" keyword | +20 | Screenshot shows pending transaction |
| No transaction ID | +30 | No 12-16 digit UPI reference found |

**Decision Rule:**
- `fraud_score < 40` → Status: `success` (Payment approved)
- `fraud_score >= 40` → Status: `rejected_fraud` (Payment rejected)

## Security Features

1. **Payment Signatures** - HMAC-SHA256 signed to prevent tampering
2. **Row-Level Security (RLS)** - Payments isolated by participant
3. **File Hash Verification** - SHA256 prevents duplicate file reuse
4. **Auto-Expiry** - Payments expire after configurable time
5. **Rate Limiting** - 20 requests/minute on payment endpoints
6. **S3 Presigned URLs** - Temporary, limited-access upload URLs

## Database Triggers

1. `trg_payments_updated_at` - Auto-updates `updated_at` timestamp
2. `trg_sync_payment_status` - Syncs payment status to participants table
3. `trg_reject_expired_pending` - Auto-rejects expired pending/processing payments

## Indexes for Performance

- `idx_payments_unique_upi_ref` - Prevent duplicate UPI transaction references
- `idx_payments_expired_pending` - Fast lookup of expired pending payments
- `idx_payments_one_active_per_participant` - One active payment per participant
- `idx_payment_files_sha256_unique` - Prevent file reuse across payments
- `idx_fraud_signals_payment` - Fast fraud signal lookup

## Frontend Integration Guide

### 1. Display QR Code
```javascript
const qrImage = document.createElement('img');
qrImage.src = `data:image/png;base64,${response.qr_base64}`;
container.appendChild(qrImage);
```

### 2. Open UPI Link (Mobile)
```javascript
// Auto-open UPI app on mobile devices
window.location.href = response.upi_link;
```

### 3. Upload Payment Proof
```javascript
async function uploadPaymentProof(file, uploadUrl) {
  await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': 'image/jpeg' }
  });
}
```

### 4. Compute SHA256 Hash
```javascript
async function computeSHA256(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### 5. Complete Payment Flow
```javascript
// 1. Create payment
const createRes = await fetch('/payments/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ public_id, amount: 100.00 })
});
const { payment_id, upi_link, qr_base64 } = await createRes.json();

// 2. Show QR code and UPI link
displayQRCode(qr_base64);
showUPIButton(upi_link);

// 3. Get upload URL
const uploadRes = await fetch(`/payments/${payment_id}/upload-url`, {
  method: 'POST'
});
const { upload_url, object_key } = await uploadRes.json();

// 4. Upload screenshot
await uploadPaymentProof(file, upload_url);

// 5. Compute hash and finalize
const sha256 = await computeSHA256(file);
await fetch(`/payments/${payment_id}/finalize`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ object_key, sha256 })
});
```

## Deployment Checklist

### System Dependencies
- [ ] Install Tesseract OCR
  ```bash
  sudo apt install tesseract-ocr  # Ubuntu/Debian
  brew install tesseract           # macOS
  ```

### Environment Variables
- [ ] Set `UPI_VPA` (your UPI virtual payment address)
- [ ] Set `UPI_NAME` (business/personal name)
- [ ] Set `PAYMENT_SECRET` (generate with `openssl rand -hex 32`)
- [ ] Set `AWS_ACCESS_KEY_ID`
- [ ] Set `AWS_SECRET_ACCESS_KEY`
- [ ] Set `AWS_REGION`
- [ ] Set `S3_BUCKET`

### AWS S3 Setup
- [ ] Create S3 bucket
- [ ] Configure CORS policy for the bucket
- [ ] Set bucket policy for write access
- [ ] Ensure IAM user has appropriate S3 permissions

### Database
- [ ] Run updated schema.sql migrations
- [ ] Verify new tables created successfully
- [ ] Test triggers and indexes

### Testing
- [ ] Test payment creation endpoint
- [ ] Verify UPI deep link format
- [ ] Test QR code generation and display
- [ ] Test S3 upload functionality
- [ ] Test OCR extraction on sample payment screenshots
- [ ] Test fraud detection with various scenarios
- [ ] Verify auto-expiry of pending payments

### Monitoring
- [ ] Set up monitoring for payment_fraud_signals table
- [ ] Track fraud score distribution
- [ ] Monitor OCR processing time
- [ ] Alert on high fraud scores
- [ ] Track payment success vs. rejection rates

## Documentation

See `PAYMENT_SYSTEM_SETUP.md` for detailed setup instructions and API documentation.

## Future Enhancements

1. **Async Processing** - Use Celery for async OCR processing
2. **Multi-Language OCR** - Support for regional languages in screenshots
3. **Fraud ML Model** - Train ML model for more sophisticated fraud detection
4. **Webhook Notifications** - Notify on payment status changes
5. **Retry Logic** - Automatic retry for failed OCR attempts
6. **Dashboard** - Admin dashboard for monitoring payments and fraud
7. **Export Reports** - Generate payment verification reports

## Notes

- The payment verification endpoint (`/internal/payments/.../verify`) is rate-limiter exempt and intended for internal use by a background worker
- Payment proofs are stored in S3 with SHA256 hash verification to prevent reuse
- All payment-related tables have Row-Level Security enabled
- Payments automatically expire after `PAYMENT_EXPIRY_SECONDS` (default: 900 seconds)
- Fraud scores are logged in `payment_fraud_signals` for analysis
