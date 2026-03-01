# Payment Verification Bug Fix

## Issue
When users clicked on "Verify" after uploading a payment screenshot, they received the error:
> "Payment verification failed due to a system error. Please try again or contact support if the problem persists."

## Root Cause
The payment verification code had a **hardcoded check** for the recipient name "Gaurav" in `/backend/app/utils/ocr.py`:

```python
# Check 1: Banking name must include "Gaurav"
if 'gaurav' not in lower:
    failures.append("invalid_banking_name")
```

However, the actual UPI recipient name is configured via the `UPI_NAME` environment variable:
- Development: "Test User"
- Production: "Your Business Name" (or whatever is configured)

This mismatch caused **ALL payment verifications to fail** because:
1. The OCR would extract the correct recipient name from the screenshot
2. The code would check if "gaurav" was in the extracted text
3. Since the recipient name wasn't "Gaurav", the verification would fail
4. Depending on where the error occurred, it would either show a fraud error or a system error

## Changes Made

### 1. Backend - `/backend/app/utils/ocr.py`
- Added `expected_upi_name` parameter to `verify_payment_screenshot()` function
- Changed the hardcoded check from `'gaurav' not in lower` to use the configured `UPI_NAME`
- Updated function documentation to reflect the change

**Before:**
```python
def verify_payment_screenshot(
    image: Image.Image,
    text: str,
    expected_amount: float,
    payment_note: str,
    confidence: float
) -> Tuple[bool, Optional[str], List[str]]:
```

**After:**
```python
def verify_payment_screenshot(
    image: Image.Image,
    text: str,
    expected_amount: float,
    payment_note: str,
    confidence: float,
    expected_upi_name: str
) -> Tuple[bool, Optional[str], List[str]]:
```

**Before:**
```python
# Check 1: Banking name must include "Gaurav"
if 'gaurav' not in lower:
    failures.append("invalid_banking_name")
```

**After:**
```python
# Check 1: Banking name must match the configured UPI name
if expected_upi_name and expected_upi_name.lower() not in lower:
    failures.append("invalid_banking_name")
```

### 2. Backend - `/backend/app/routes/payment.py`
- Imported `UPI_NAME` from config
- Updated both calls to `verify_payment_screenshot()` to pass `UPI_NAME` as the last parameter

**Before:**
```python
from app.config import PAYMENT_EXPIRY_SECONDS
```

**After:**
```python
from app.config import PAYMENT_EXPIRY_SECONDS, UPI_NAME
```

**Before:**
```python
is_valid, detected_app, failures = verify_payment_screenshot(
    image, extracted_text, amount, payment_note, confidence
)
```

**After:**
```python
is_valid, detected_app, failures = verify_payment_screenshot(
    image, extracted_text, amount, payment_note, confidence, UPI_NAME
)
```

### 3. Frontend - `/frontend/src/pages/PaymentLinkPage.jsx`
- Fixed error code mapping for `invalid_banking_name` from `FRAUD_002_0001` to `FRAUD_001_0004`
- `FRAUD_001_0004` is the correct error code for "Payment not made to correct beneficiary"

**Before:**
```javascript
invalid_banking_name: 'FRAUD_002_0001',
```

**After:**
```javascript
invalid_banking_name: 'FRAUD_001_0004',
```

### 4. Frontend - `/frontend/src/utils/errorRegistry.js`
- Added error message for `FRAUD_001_0004`: "Payment not made to correct beneficiary"

**Added:**
```javascript
'FRAUD_001_0004': 'Payment not made to correct beneficiary',
```

## Impact
- Payment verification will now correctly validate against the configured UPI recipient name
- Users will receive clear, accurate error messages when verification fails
- The system error message will no longer appear for normal verification failures
- All payment screenshots will be validated against the correct recipient name as configured in `UPI_NAME` environment variable

## Testing Recommendations
1. Test payment verification with a valid payment screenshot containing the correct recipient name
2. Test with an invalid payment screenshot (wrong recipient name) - should show "Payment not made to correct beneficiary"
3. Test with other validation failures (wrong amount, missing timestamp, etc.) to ensure those errors still display correctly
4. Verify that the `UPI_NAME` environment variable is properly set in all environments (development, staging, production)
