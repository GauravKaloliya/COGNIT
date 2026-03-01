# AWS Textract Troubleshooting Guide

This document explains why AWS Textract OCR service may be unavailable and how to resolve each issue.

## Overview

The C.O.G.N.I.T. payment verification system uses AWS Textract for OCR (Optical Character Recognition) to extract text from UPI payment screenshots. When Textract is unavailable, payment verification fails automatically and the payment is marked as `rejected_fraud`.

## Common Causes & Solutions

### 1. Missing AWS Credentials

**Symptom:** Error message: `"AWS credentials not configured"`

**Cause:** The required AWS credentials are not set in the environment variables.

**Solution:**
Set the following environment variables:

```bash
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_REGION=ap-south-1  # or your preferred region
```

**How to obtain AWS credentials:**
1. Log into AWS Console
2. Navigate to IAM → Users → Create User
3. Attach the `AmazonTextractFullAccess` policy (or a more restrictive custom policy)
4. Create access keys for the user
5. Copy the Access Key ID and Secret Access Key

---

### 2. Invalid AWS Credentials

**Symptom:** Error message: `"Failed to initialize Textract client"` with authentication error

**Cause:** The AWS credentials are invalid, expired, or have insufficient permissions.

**Solution:**
1. Verify credentials are correct in `.env` file
2. Check if the IAM user has the required permissions:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "textract:DetectDocumentText",
           "textract:AnalyzeDocument"
         ],
         "Resource": "*"
       }
     ]
   }
   ```
3. Check if credentials have been rotated or deactivated in AWS IAM

---

### 3. AWS Region Not Supported

**Symptom:** Error message indicating service unavailable in region

**Cause:** Textract is not available in all AWS regions.

**Solution:**
Use a region where Textract is available:
- US East (N. Virginia) - `us-east-1`
- US West (Oregon) - `us-west-2`
- Europe (Ireland) - `eu-west-1`
- Asia Pacific (Mumbai) - `ap-south-1`
- Asia Pacific (Singapore) - `ap-southeast-1`
- Asia Pacific (Sydney) - `ap-southeast-2`

Set in environment:
```bash
AWS_REGION=ap-south-1
```

---

### 4. AWS Service Throttling

**Symptom:** Error message: `"Textract rate limited: ThrottlingException"` or `"ProvisionedThroughputExceededException"`

**Cause:** You've exceeded the default Textract API rate limits.

**Default Limits:**
- StartDocumentTextDetection: 10 transactions per second (TPS)
- GetDocumentTextDetection: 100 TPS
- DetectDocumentText: 10 TPS

**Solution:**
1. **Short term:** Wait and retry the request
2. **Long term:** Request a quota increase via AWS Support Console
   - Go to AWS Service Quotas
   - Request increase for "Textract DetectDocumentText"

---

### 5. Network Connectivity Issues

**Symptom:** Error message: `"Textract connection error"`

**Cause:** The server cannot reach AWS Textract endpoints.

**Possible reasons:**
- VPC endpoint misconfiguration
- Security group blocking outbound traffic
- DNS resolution issues
- Firewall restrictions

**Solution:**
1. Verify outbound HTTPS (port 443) is allowed
2. Check if VPC endpoints for Textract are properly configured
3. Test connectivity:
   ```bash
   curl -I https://textract.ap-south-1.amazonaws.com
   ```

---

### 6. AWS Account Issues

**Symptom:** Various authentication/authorization errors

**Cause:** AWS account level issues

**Common issues:**
- Account suspended or closed
- Billing issues (payment method expired)
- Service limit reached
- AWS service outage

**Solution:**
1. Check AWS Service Health Dashboard
2. Verify billing information in AWS Console
3. Check for any AWS notifications

---

## Environment Configuration

### Required Environment Variables

```env
# AWS Configuration
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=ap-south-1
S3_BUCKET_NAME=your-bucket-name

# OCR Configuration
MIN_OCR_CONFIDENCE=55
MIN_IMAGE_WIDTH=600
```

### Development Setup

For local development, create a `.env` file:

```env
# Use AWS credentials with Textract permissions
AWS_ACCESS_KEY_ID=your-dev-key
AWS_SECRET_ACCESS_KEY=your-dev-secret
AWS_REGION=ap-south-1
S3_BUCKET_NAME=cognit-dev
```

### Production Setup (Vercel)

Set environment variables in Vercel Dashboard:
1. Go to Project → Settings → Environment Variables
2. Add each variable:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_REGION`
   - `S3_BUCKET_NAME`

---

## Error Handling in Code

The application handles Textract unavailability gracefully:

### Exception Classes

```python
class OCRServiceUnavailableError(Exception):
    """Raised when OCR service is not available"""
    pass

class TesseractNotFoundError(OCRServiceUnavailableError):
    """Legacy alias for backward compatibility"""
    pass
```

### Detection Function

```python
def _is_ocr_unavailable(error: Exception) -> bool:
    """Check if the error indicates OCR service is unavailable."""
    return (
        isinstance(error, (OCRServiceUnavailableError, TesseractNotFoundError))
        or "aws credentials" in str(error).lower()
        or "rate limited" in str(error).lower()
        or "connection error" in str(error).lower()
    )
```

### Auto-Rejection

When Textract is unavailable:
1. Payment is automatically marked as `rejected_fraud`
2. Fraud signal is logged with type `ocr_unavailable`
3. Screenshot is deleted from S3
4. User must retry with a new payment

---

## Testing AWS Textract Connectivity

### Quick Test Script

```python
import boto3

def test_textract():
    try:
        client = boto3.client(
            'textract',
            region_name='ap-south-1',
            aws_access_key_id='YOUR_KEY',
            aws_secret_access_key='YOUR_SECRET'
        )
        
        # Simple test with a small image
        response = client.detect_document_text(
            Document={'Bytes': b'test'}
        )
        print("✅ Textract is accessible")
        return True
    except Exception as e:
        print(f"❌ Textract error: {e}")
        return False

test_textract()
```

### AWS CLI Test

```bash
aws textract detect-document-text \
  --document '{"S3Object":{"Bucket":"your-bucket","Name":"test-image.jpg"}}' \
  --region ap-south-1
```

---

## Monitoring & Alerts

### Recommended CloudWatch Metrics

- `SuccessfulRequestCount` - Track successful OCR operations
- `ThrottledCount` - Monitor rate limiting issues
- `ServerErrorCount` - Track AWS-side errors
- `ResponseTime` - Monitor OCR latency

### Setting Up Alerts

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "TextractHighErrorRate" \
  --metric-name "ServerErrorCount" \
  --namespace AWS/Textract \
  --threshold 5 \
  --evaluation-periods 3 \
  --period 300
```

---

## Cost Considerations

### AWS Textract Pricing (as of 2024)

- **DetectDocumentText**: $0.0015 per page (first 1M pages/month)
- **AnalyzeDocument**: $0.05 per page (first 1M pages/month)

### Cost Optimization Tips

1. Pre-validate images before sending to Textract
2. Resize large images before OCR processing
3. Use S3 direct integration for large documents
4. Monitor usage and set up billing alerts

---

## Checklist for Deployment

- [ ] AWS credentials configured in environment
- [ ] IAM user has `textract:DetectDocumentText` permission
- [ ] S3 bucket exists and is accessible
- [ ] Region is set to a Textract-supported region
- [ ] Network allows outbound HTTPS to AWS endpoints
- [ ] CloudWatch monitoring configured (optional)
- [ ] Billing alerts set up (optional)

---

## Related Files

- `backend/app/utils/ocr.py` - OCR implementation
- `backend/app/routes/payment.py` - Payment verification
- `backend/app/config.py` - Configuration constants
- `backend/.env.example` - Environment template
