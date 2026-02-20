# UPI Payment System Setup Guide

This document describes the setup and configuration for the new UPI payment system with OCR fraud detection.

## 📦 Additional Dependencies

Install the following Python packages:

```bash
pip install pillow pytesseract qrcode redis celery opencv-python boto3
```

Install Tesseract OCR on your system:

```bash
# Ubuntu/Debian
sudo apt install tesseract-ocr

# macOS
brew install tesseract

# Windows
# Download from https://github.com/UB-Mannheim/tesseract/wiki
```

## 🔐 Required Environment Variables

### UPI Configuration
```
UPI_VPA=yourvpa@upi              # Your UPI VPA (Virtual Payment Address)
UPI_NAME=YourBusinessName         # Your business/personal name
```

### Payment Security
```
PAYMENT_SECRET=super_long_random_secret_here  # Generate with: openssl rand -hex 32
PAYMENT_EXPIRY_SECONDS=900                    # Payment expiry in seconds (default: 900 = 15 min)
```

### AWS S3 Configuration
```
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=ap-south-1                         # Your AWS region
S3_BUCKET=cognitapi                           # Your S3 bucket name
```

## 🌐 API Endpoints

### 1. Create Payment
```
POST /payments/create
```

**Request Body:**
```json
{
  "public_id": "550e8400-e29b-41d4-a716-446655440000",
  "amount": 100.00
}
```

**Response:**
```json
{
  "payment_id": "uuid-of-payment",
  "amount": 100.00,
  "expires_at": "2024-01-01T12:00:00Z",
  "signature": "sha256-signature",
  "upi_link": "upi://pay?pa=vpa@upi&pn=Name&am=100.00&cu=INR&tn=Payment+uuid",
  "qr_base64": "iVBORw0KGgoAAAANSUhEUgAA..."
}
```

### 2. Generate Upload URL
```
POST /payments/<payment_public_id>/upload-url
```

**Response:**
```json
{
  "upload_url": "https://s3.ap-south-1.amazonaws.com/cognitapi/payments/uuid.jpg?X-Amz-Signature=...",
  "object_key": "payments/uuid.jpg"
}
```

### 3. Finalize Upload
```
POST /payments/<payment_public_id>/finalize
```

**Request Body:**
```json
{
  "object_key": "payments/uuid.jpg",
  "sha256": "a1b2c3d4e5f6... (64 character hex string)"
}
```

**Response:**
```json
{
  "status": "uploaded"
}
```

### 4. Verify Payment (Internal)
```
POST /internal/payments/<payment_public_id>/verify
```

**Response:**
```json
{
  "status": "verified",
  "fraud_score": 10.5,
  "upi_reference": "123456789012"
}
```

## 🧠 Fraud Detection Logic

The OCR-based fraud detection assigns scores based on the following:

| Factor | Score | Description |
|--------|-------|-------------|
| Missing amount | +30 | Payment amount not found in extracted text |
| "failed" keyword | +40 | Indicates failed transaction |
| "pending" keyword | +20 | Indicates pending transaction |
| No transaction ID | +30 | No 12-16 digit number found |

**Fraud Threshold:**
- Score < 40: Payment approved (`success`)
- Score >= 40: Payment rejected (`rejected_fraud`)

## 💾 Database Schema Updates

### New Tables:
- `payments` - Enhanced payment records with UPI and fraud detection fields
- `payment_files` - S3-backed payment proof files
- `payment_submissions` - Link payments to submissions
- `payment_fraud_signals` - Individual fraud detection signals

### New Functions:
- `sync_participant_payment_status()` - Automatically updates participant payment status
- `reject_expired_pending_payments()` - Auto-rejects expired payments

## 🔒 Security Features

1. **Row-Level Security (RLS)** - Payments are isolated by participant
2. **Payment Signatures** - HMAC-SHA256 signed payment requests
3. **SHA256 File Hashing** - Prevents duplicate file reuse
4. **Expiry Checks** - Payments auto-expire after configured time
5. **Fraud Scoring** - OCR-based automated fraud detection
6. **Rate Limiting** - 20 requests per minute on payment endpoints

## 📱 Frontend Integration

### Display QR Code
```javascript
const qrImage = document.createElement('img');
qrImage.src = `data:image/png;base64,${response.qr_base64}`;
document.body.appendChild(qrImage);
```

### Open UPI Link (Mobile)
```javascript
// For UPI-enabled mobile apps
window.location.href = response.upi_link;
```

### Upload Payment Proof
```javascript
async function uploadPaymentProof(file, uploadUrl) {
  await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': 'image/jpeg'
    }
  });
}
```

### Compute SHA256
```javascript
async function computeSHA256(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

## 🚀 Deployment Notes

1. Ensure Tesseract is installed and accessible on the server
2. Configure AWS credentials with S3 write access
3. Set up proper CORS headers for your frontend
4. Consider setting up a Celery worker for async OCR processing
5. Monitor payment_fraud_signals table for fraud patterns

## 📊 Monitoring

Track these metrics:
- Payment success vs. rejection rates
- Average fraud scores
- Common fraud signal types
- OCR processing time
- S3 upload failures
