# Payment System v2.0 Migration - Quick Start

## Files Created

The following new files have been created for the v2.0 payment system redesign:

### Core Files
- **`app_v2.py`** (42KB) - Complete redesigned application with automatic verification
- **`schema_v2.sql`** (18KB) - New database schema with AWS S3 support
- **`migrate_to_v2.py`** (11KB) - Migration script from old to new schema

### Documentation
- **`PAYMENT_V2_REDESIGN.md`** (7.2KB) - Complete redesign documentation
- **`.env.example`** (updated) - New environment variables

### Old Files (Deprecated)
- `app.py` - Old application (keep as backup)
- `schema.sql` - Old schema (keep as backup)
- `DATABASE_FIX.md` - Old fix doc
- `fix_payment_reference_column.sql` - Old fix
- `migrate_payment_reference.py` - Old migration

## Quick Migration Steps

### 1. Backup Current System
```bash
# Backup current files
cp app.py app_old.py
cp schema.sql schema_old.sql
```

### 2. Run Migration Script
```bash
cd backend
python migrate_to_v2.py
```

### 3. Update Environment
```bash
# Copy new environment variables
cp .env.example .env
# Edit .env with your values
```

### 4. Test New System
```bash
# Start new application
python app_v2.py
```

### 5. Switch to New App
```bash
# Rename files (when ready)
mv app_v2.py app.py
mv schema_v2.sql schema.sql
```

## What's New in v2.0

✅ **No Razorpay** - Completely removed
✅ **Automatic Verification** - No admin intervention needed
✅ **AWS S3 Images** - All images (payment + survey) from S3
✅ **EasyOCR UTR Extraction** - Deep-learning OCR for better accuracy
✅ **External Verification API** - Optional bank integration
✅ **Secured Routes** - Rate limiting and validation
✅ **Better Error Handling** - Clear error messages

## Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/payment/upi-details` | POST | Get UPI QR code |
| `/payment/submit` | POST | Submit payment proof (auto-verified) |
| `/payment/status/<id>` | GET | Check payment status |
| `/survey/images` | GET | Get survey images from S3 |

## Environment Variables Required

```bash
# Database
DATABASE_URL=postgresql://...

# UPI Payment
UPI_ID=yourname@upi
UPI_PAYEE_NAME=Your Name
PAYMENT_AMOUNT=100

# AWS S3 (REQUIRED)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket
S3_IMAGES_PREFIX=survey-images/
S3_PAYMENT_PROOFS_PREFIX=payment-proofs/

# Optional: Auto Verification
UPI_VERIFICATION_API_URL=https://api.example.com/verify
UPI_VERIFICATION_API_KEY=...
```

## Python Dependencies

```bash
# Install required packages
pip install easyocr numpy

# Or use requirements.txt
pip install -r requirements.txt
```

## Need Help?

Read **`PAYMENT_V2_REDESIGN.md`** for complete documentation including:
- Database schema changes
- API documentation
- Troubleshooting guide
- Security considerations

## Testing the New System

1. **Health Check**: `GET /health`
2. **API Docs**: `GET /api/docs`
3. **Get UPI Details**: `POST /payment/upi-details`
4. **Submit Payment**: `POST /payment/submit`
5. **Check Status**: `GET /payment/status/<participant_id>`

## Migration Verification

After running `migrate_to_v2.py`, verify with:

```sql
-- Check new tables exist
SELECT * FROM upi_transactions LIMIT 1;

-- Check new columns in payments
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'payments' 
AND column_name IN ('auto_verified', 's3_key', 'verification_method');

-- Check indexes
SELECT indexname FROM pg_indexes 
WHERE indexname LIKE 'idx_payments%' OR indexname LIKE 'idx_upi_transactions%';
```