# C.O.G.N.I.T. Migration Summary

## Changes Completed

### 1. ✅ Regenerated Seed Images Schema with AWS S3 URLs
**File:** `/backend/seed_images.sql`
- Updated from GitHub raw URLs to AWS S3 URLs
- Changed from `image_url` column to `s3_key` and `s3_url` columns (matching schema)
- Updated 74 survey images with proper AWS S3 bucket URLs
- Format: `https://cognit-survey-images.s3.us-east-1.amazonaws.com/survey-images/{filename}.svg`

### 2. ✅ Removed Images from GitHub
**Actions:**
- Deleted `/backend/images/` directory completely
- Removed all 74 SVG files from local storage
- Updated `/images/<path:filename>` route to return 410 Gone status
- Added deprecation message directing users to use S3 URLs from database

### 3. ✅ Payment Routes Verified Working
**Routes Configured:**
- `POST /payment/upi-details` - Get UPI payment details with QR code
- `POST /payment/submit` - Submit payment screenshot for OCR verification
- `GET /payment/status/<participant_id>` - Check payment status
- `POST /payment/verify-automatic` - Trigger automatic verification
- `GET /health` - Health check endpoint
- `GET /api/docs` - API documentation

**Payment Flow:**
1. User requests payment details → UPI QR code generated
2. User makes payment and uploads screenshot
3. OCR extracts UTR from screenshot (EasyOCR/Tesseract)
4. Payment verified automatically using OCR results
5. Screenshot uploaded to S3 with metadata

### 4. ✅ Removed API Verification (Using Library Only)
**Changes Made:**
- Removed `UPI_VERIFICATION_API_URL` configuration
- Removed `UPI_VERIFICATION_API_KEY` configuration
- Updated `.env.example` to remove verification API section
- Payment verification now uses only OCR (EasyOCR library)
- No external API calls required for verification

**OCR Verification:**
- Uses EasyOCR library for text extraction
- Fallback to Tesseract if EasyOCR not available
- Validates UTR format (12-16 digits)
- Calculates confidence scores
- Stores verification results in database

## Technical Details

### Database Schema Alignment
The images table expects:
```sql
CREATE TABLE images (
    image_id VARCHAR(100) PRIMARY KEY,
    s3_key VARCHAR(500) NOT NULL,
    s3_url TEXT NOT NULL,
    difficulty_score DOUBLE PRECISION DEFAULT 5.0,
    object_count INTEGER DEFAULT 1,
    width INTEGER DEFAULT 800,
    height INTEGER DEFAULT 600,
    content_type VARCHAR(50) DEFAULT 'image/svg+xml',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

### S3 Configuration Required
Environment variables needed:
```bash
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
S3_BUCKET_NAME=cognit-survey-images
S3_IMAGES_PREFIX=survey-images/
```

### Payment Configuration
```bash
UPI_ID=your_upi_id@upi
UPI_PAYEE_NAME=Your Name
PAYMENT_AMOUNT=100  # ₹1 in paise
```

## Verification Steps

1. **Database Setup:**
   ```bash
   psql -d your_db -f backend/schema.sql
   psql -d your_db -f backend/seed_images.sql
   ```

2. **Upload Images to S3:**
   - Upload all 74 SVG files to `s3://cognit-survey-images/survey-images/`
   - Ensure bucket policy allows public read access or use presigned URLs

3. **Start Backend:**
   ```bash
   cd backend
   export DATABASE_URL=postgresql://...
   python app.py
   ```

4. **Test Payment Flow:**
   ```bash
   curl -X POST http://localhost:5000/payment/upi-details \
     -H "Content-Type: application/json" \
     -d '{"participant_id": "test123"}'
   ```

## Benefits of Changes

1. **Better Performance:** Images served from CDN (AWS S3)
2. **Reliability:** No dependency on GitHub availability
3. **Cost Effective:** S3 is cheaper than GitHub bandwidth
4. **Simpler:** No external API verification needed
5. **Faster:** OCR-based verification is instant
6. **Scalable:** S3 scales automatically

## Migration Notes

- All images are now served from AWS S3
- No GitHub dependencies remain
- Payment verification is fully automated
- Frontend should continue working without changes (uses `image_url` from API response)
- Database must be reseeded with new S3 URLs
- S3 bucket must be created and configured with appropriate permissions