# C.O.G.N.I.T. API Documentation

## Overview

C.O.G.N.I.T. (Consortium for Observational Neurocognitive and Generative Image Technology) is a research survey platform where participants view images and provide detailed descriptions, ratings, and feedback.

### Base URL
```
https://cognit.online/api
```

### Authentication
All endpoints (except health check) require:
- `public_id`: UUID of the participant
- `session_id`: Session identifier from frontend
- `X-Real-IP` or `X-Forwarded-For`: Client IP address for security
- `User-Agent`: Client user agent string

### Rate Limiting
- Default: 30 requests per minute per IP
- Endpoints may have custom rate limits (documented per endpoint)
- Rate limit headers included in all responses

### Error Format
All errors follow this standardized format:
```json
{
    "error": true,
    "error_code": "ERROR_CODE",
    "error_message": "Human readable message",
    "category": "VAL|AUTH|SYS|RATE|DUP|FRAUD|PAY",
    "field": "field_name", // Optional, for validation errors
    "details": {}, // Optional, additional error details
    "request_id": "uuid"
}
```

### Error Codes

#### System Errors (SYS)
- `SYS_001_0001`: Internal server error
- `SYS_001_0002`: Database error
- `SYS_001_0003`: Service unavailable
- `SYS_001_0004`: Configuration error

#### Rate Limit Errors (RATE)
- `RATE_001_0001`: Too many attempts
- `RATE_001_0002`: Rate limit exceeded

#### Validation Errors (VAL)
- `VAL_MISSING_FIELDS`: Required fields missing
- `VAL_INVALID_FORMAT`: Invalid request format
- `VAL_USERNAME_INVALID`: Invalid username format
- `VAL_EMAIL_INVALID`: Invalid email format
- `VAL_PHONE_INVALID`: Invalid phone format
- `VAL_AGE_INVALID`: Invalid age (13-100)
- `VAL_DESC_LENGTH`: Description length invalid
- `VAL_FEEDBACK_LENGTH`: Feedback length invalid
- `VAL_RATING_INVALID`: Rating must be 1-10
- `VAL_WORD_COUNT`: Minimum word count required

#### Duplicate/Conflict Errors (DUP)
- `DUP_USERNAME`: Username already taken
- `DUP_EMAIL`: Email already registered
- `DUP_PHONE`: Phone already registered
- `DUP_SUBMISSION`: Already described this image
- `DUP_PAYMENT_IMAGE`: Screenshot already submitted

#### Authentication Errors (AUTH)
- `AUTH_CONSENT_REQUIRED`: Must agree to consent
- `AUTH_ACCOUNT_FLAGGED`: Account flagged
- `AUTH_ACCESS_DENIED`: Access denied

#### Payment Errors (PAY)
- `PAY_SESSION_EXPIRED`: Payment session expired
- `PAY_UPLOAD_FAILED`: File upload failed
- `PAY_VERIFICATION_FAILED`: Payment verification failed
- `PAY_AMOUNT_INVALID`: Invalid payment amount
- `PAY_TIMER_NOT_STARTED`: Payment timer not started
- `PAY_EXPIRED`: Payment expired
- `PAY_PENDING`: Payment still pending
- `PAY_REQUIRED`: Payment required

#### Fraud Errors (FRAUD)
- `FRAUD_HIGH_RISK`: High fraud risk detected
- `FRAUD_DUPLICATE_IMAGE`: Duplicate payment image
- `FRAUD_SUSPICIOUS_PATTERN`: Suspicious pattern detected

---

## Endpoints

### Health Check

#### GET /health

Health check endpoint to verify service status.

**Rate Limit:** Unlimited (exempt)

**Response:**
```json
{
    "status": "healthy",
    "database": "connected"
}
```

**Status Codes:**
- `200`: Service healthy
- `503`: Service degraded

---

### Participant Registration

#### POST /participants

Create a new participant account.

**Rate Limit:** 30 per minute

**Headers:**
- `Content-Type: application/json`

**Request Body:**
```json
{
    "public_id": "string (UUID)",
    "session_id": "string (max 128 chars)",
    "username": "string (2-50 chars, alphanumeric + underscore)",
    "email": "string (valid email)",
    "phone": "string (10 digit Indian mobile)",
    "gender_code": "string (male|female|non-binary|prefer-not-say|other)",
    "age": "integer (13-100)",
    "location": "string (max 120 chars)",
    "language_code": "string (en|hi|bn|te|mr|ta|ur|gu|kn|ml|other)",
    "prior_experience": "string (max 120 chars)"
}
```

**Success Response (201):**
```json
{
    "status": "created",
    "public_id": "string (UUID)"
}
```

**Error Responses:**
- `400`: Validation errors
- `409`: Duplicate username/email/phone
- `500`: Internal error

---

### Validation Endpoints

#### GET /check-username

Check if username is available.

**Rate Limit:** 30 per minute

**Query Parameters:**
- `username` (required): Username to check

**Response:**
```json
{
    "available": boolean
}
```

---

#### GET /check-email

Check if email is available.

**Rate Limit:** 30 per minute

**Query Parameters:**
- `email` (required): Email to check

**Response:**
```json
{
    "available": boolean
}
```

---

#### GET /check-phone

Check if phone number is available.

**Rate Limit:** 30 per minute

**Query Parameters:**
- `phone` (required): Phone number to check

**Response:**
```json
{
    "available": boolean
}
```

---

### Consent

#### POST /consent

Record participant consent to terms.

**Rate Limit:** 30 per minute

**Request Body:**
```json
{
    "public_id": "string (UUID)"
}
```

**Success Response (200):**
```json
{
    "status": "consented",
    "public_id": "string (UUID)"
}
```

---

### Images

#### GET /images/random

Get random images for survey or attention checks.

**Rate Limit:** 30 per minute

**Query Parameters:**
- `count` (optional, default: 1): Number of images to return
- `include_attention` (optional, default: false): Include attention check images

**Response:**
```json
{
    "images": [
        {
            "id": "integer",
            "image_id": "string",
            "url": "string (URL)",
            "width": "integer",
            "height": "integer",
            "difficulty": "float (0-10)",
            "object_count": "integer",
            "tags": ["string"],
            "is_attention_check": "boolean"
        }
    ]
}
```

---

### Submissions

#### POST /submit

Submit image description and ratings.

**Rate Limit:** 30 per minute

**Request Headers:**
- `public_id` (header): Participant UUID
- `Content-Type: application/json`

**Request Body:**
```json
{
    "request_id": "string (UUID)",
    "image_id": "string",
    "description": "string (60-10000 chars)",
    "rating": "integer (1-10)",
    "feedback": "string (5-2000 chars)",
    "time_spent_seconds": "float",
    "is_survey": "boolean (default: false)",
    "is_attention_check": "boolean (default: false)",
    "survey_index": "integer (for survey rounds)",
    "extra_metadata": {}
}
```

**Success Response (201):**
```json
{
    "status": "submitted",
    "request_id": "string (UUID)",
    "quality_score": "float (0-1)",
    "attention_passed": "boolean (for attention checks)"
}
```

**Validation Requirements:**
- Description: 60-10000 characters, min 60 words
- Feedback: 5-2000 characters
- Rating: 1-10
- Payment required (payment_status must be 'paid')

---

### Engagement Tracking

#### POST /engagement/track

Track user engagement metrics.

**Rate Limit:** 60 per minute

**Request Headers:**
- `public_id` (header): Participant UUID

**Request Body:**
```json
{
    "request_id": "string (UUID)",
    "image_id": "string",
    "tab_switch_count": "integer (default: 0)",
    "page_close_attempts": "integer (default: 0)",
    "network_disconnects": "integer (default: 0)",
    "time_spent_seconds": "float",
    "extra_metadata": {}
}
```

**Success Response (200):**
```json
{
    "status": "tracked"
}
```

---

### Payments

#### POST /payments/create

Create a new payment session.

**Rate Limit:** 10 per minute

**Request Headers:**
- `public_id` (header): Participant UUID

**Response:**
```json
{
    "status": "created",
    "payment": {
        "public_id": "string (UUID)",
        "amount": "integer",
        "currency": "string",
        "upi_vpa": "string",
        "upi_name": "string",
        "expires_at": "string (ISO 8601 timestamp)",
        "qr_code": "string (base64 PNG)"
    }
}
```

**Error Responses:**
- `403`: Payment required
- `429`: Too many attempts

---

#### POST /payments/{payment_public_id}/upload-url

Get pre-signed URL for payment proof upload.

**Rate Limit:** 10 per minute

**Path Parameters:**
- `payment_public_id` (required): Payment UUID

**Request Headers:**
- `public_id` (header): Participant UUID

**Response:**
```json
{
    "upload_url": "string (pre-signed S3 URL)",
    "fields": {}, // Additional upload fields
    "object_key": "string",
    "expires_at": "string (ISO 8601 timestamp)"
}
```

**Error Responses:**
- `404`: Payment not found
- `410`: Payment expired
- `429`: Too many attempts

---

#### POST /payments/{payment_public_id}/finalize

Finalize payment after proof upload.

**Rate Limit:** 10 per minute

**Path Parameters:**
- `payment_public_id` (required): Payment UUID

**Request Headers:**
- `public_id` (header): Participant UUID

**Request Body:**
```json
{
    "object_key": "string",
    "file_name": "string"
}
```

**Success Response (200):**
```json
{
    "status": "finalized",
    "payment_status": "string (pending|processing|success|failed)",
    "verification_attempts": "integer",
    "expires_at": "string (ISO 8601 timestamp)"
}
```

**Error Responses:**
- `404`: Payment not found
- `410`: Payment expired
- `422`: Upload validation failed

---

#### GET /payments/{payment_public_id}/status

Get payment status.

**Rate Limit:** 30 per minute

**Path Parameters:**
- `payment_public_id` (required): Payment UUID

**Request Headers:**
- `public_id` (header): Participant UUID

**Response:**
```json
{
    "status": "string (pending|processing|success|failed|expired)",
    "amount": "integer",
    "currency": "string",
    "expires_at": "string (ISO 8601 timestamp)",
    "verified_at": "string (ISO 8601 timestamp, nullable)"
}
```

**Error Responses:**
- `404`: Payment not found

---

### Internal Payment Verification

#### POST /internal/payments/{payment_public_id}/verify

**Rate Limit:** Unlimited (internal only)

Verify payment (internal/automation use only).

**Path Parameters:**
- `payment_public_id` (required): Payment UUID

**Request Headers:**
- `X-Internal-Key`: Internal verification key

**Request Body:**
```json
{
    "action": "string (approve|reject)",
    "reason": "string (optional)"
}
```

**Success Response (200):**
```json
{
    "status": "verified",
    "payment_status": "string",
    "verified_at": "string (ISO 8601 timestamp)"
}
```

**Error Responses:**
- `401`: Invalid internal key
- `404`: Payment not found
- `409`: Invalid action

---

### Client Error Logging

#### POST /client-errors

Log client-side errors for debugging.

**Rate Limit:** 30 per minute

**Request Body:**
```json
{
    "error_code": "string",
    "error_message": "string",
    "error_type": "string",
    "endpoint": "string",
    "http_method": "string",
    "status_code": "integer",
    "stack_trace": "string",
    "participant_id": "integer (optional)",
    "request_data": {}
}
```

**Success Response (201):**
```json
{
    "status": "logged"
}
```

---

### Frontend Routes

#### GET /

Serve frontend application.

**Response:** HTML (React app)

---

#### GET /docs

Serve API documentation.

**Response:** HTML (API docs)

---

## Request/Response Examples

### Complete Survey Flow

1. **Create Participant**
```bash
curl -X POST https://cognit.online/api/participants \
  -H "Content-Type: application/json" \
  -d '{
    "public_id": "550e8400-e29b-41d4-a716-446655440000",
    "session_id": "session_123",
    "username": "johndoe",
    "email": "john@example.com",
    "phone": "9876543210",
    "gender_code": "male",
    "age": 25,
    "location": "Mumbai, India",
    "language_code": "en",
    "prior_experience": "First time"
  }'
```

**Response:**
```json
{
    "status": "created",
    "public_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

2. **Give Consent**
```bash
curl -X POST https://cognit.online/api/consent \
  -H "Content-Type: application/json" \
  -H "public_id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "public_id": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

3. **Get Payment Session**
```bash
curl -X POST https://cognit.online/api/payments/create \
  -H "public_id: 550e8400-e29b-41d4-a716-446655440000"
```

4. **Upload Payment Proof**
```bash
curl -X POST https://cognit.online/api/payments/{payment_id}/upload-url \
  -H "public_id: 550e8400-e29b-41d4-a716-446655440000"
```

5. **Get Images**
```bash
curl https://cognit.online/api/images/random?count=5 \
  -H "public_id: 550e8400-e29b-41d4-a716-446655440000"
```

6. **Submit Survey**
```bash
curl -X POST https://cognit.online/api/submit \
  -H "Content-Type: application/json" \
  -H "public_id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "request_id": "req_456",
    "image_id": "img_789",
    "description": "A detailed description of the image...",
    "rating": 8,
    "feedback": "Great survey experience!",
    "time_spent_seconds": 120.5,
    "is_survey": true,
    "survey_index": 0
  }'
```

---

## SDKs and Code Examples

### JavaScript/TypeScript

```typescript
import axios from 'axios';

const API_BASE = 'https://cognit.online/api';

class CognitAPI {
  private publicId: string;
  private sessionId: string;

  constructor(publicId: string, sessionId: string) {
    this.publicId = publicId;
    this.sessionId = sessionId;
  }

  async createParticipant() {
    const response = await axios.post(`${API_BASE}/participants`, {
      public_id: this.publicId,
      session_id: this.sessionId,
      username: 'username',
      email: 'email@example.com',
      phone: '9876543210',
      gender_code: 'male',
      age: 25,
      location: 'Mumbai, India',
      language_code: 'en',
      prior_experience: 'First time'
    });
    return response.data;
  }

  async getRandomImages(count = 1) {
    const response = await axios.get(`${API_BASE}/images/random?count=${count}`, {
      headers: { 'public_id': this.publicId }
    });
    return response.data;
  }

  async submitSurvey(data: any) {
    const response = await axios.post(`${API_BASE}/submit`, data, {
      headers: {
        'public_id': this.publicId,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  }
}
```

### Python

```python
import requests

API_BASE = 'https://cognit.online/api'

class CognitAPI:
    def __init__(self, public_id, session_id):
        self.public_id = public_id
        self.session_id = session_id
        self.headers = {
            'public_id': public_id,
            'Content-Type': 'application/json'
        }
    
    def create_participant(self):
        data = {
            'public_id': self.public_id,
            'session_id': self.session_id,
            'username': 'username',
            'email': 'email@example.com',
            'phone': '9876543210',
            'gender_code': 'male',
            'age': 25,
            'location': 'Mumbai, India',
            'language_code': 'en',
            'prior_experience': 'First time'
        }
        response = requests.post(f'{API_BASE}/participants', json=data)
        return response.json()
    
    def get_random_images(self, count=1):
        response = requests.get(
            f'{API_BASE}/images/random?count={count}',
            headers={'public_id': self.public_id}
        )
        return response.json()
    
    def submit_survey(self, data):
        response = requests.post(
            f'{API_BASE}/submit',
            json=data,
            headers=self.headers
        )
        return response.json()
```

### cURL

```bash
# Create participant
curl -X POST https://cognit.online/api/participants \
  -H "Content-Type: application/json" \
  -d '{
    "public_id": "550e8400-e29b-41d4-a716-446655440000",
    "session_id": "session_123",
    "username": "johndoe",
    "email": "john@example.com",
    "phone": "9876543210",
    "gender_code": "male",
    "age": 25,
    "location": "Mumbai, India",
    "language_code": "en",
    "prior_experience": "First time"
  }'

# Get images
curl https://cognit.online/api/images/random \
  -H "public_id: 550e8400-e29b-41d4-a716-446655440000"

# Submit survey
curl -X POST https://cognit.online/api/submit \
  -H "Content-Type: application/json" \
  -H "public_id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "request_id": "req_456",
    "image_id": "img_789",
    "description": "A detailed description of the image...",
    "rating": 8,
    "feedback": "Great survey experience!",
    "time_spent_seconds": 120.5,
    "is_survey": true,
    "survey_index": 0
  }'
```

---

## Webhooks

Currently not implemented. Payment verification is done via internal API.

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| /health | Unlimited |
| /participants | 30/min |
| /check-username | 30/min |
| /check-email | 30/min |
| /check-phone | 30/min |
| /consent | 30/min |
| /images/random | 30/min |
| /submit | 30/min |
| /engagement/track | 60/min |
| /payments/create | 10/min |
| /payments/{id}/upload-url | 10/min |
| /payments/{id}/finalize | 10/min |
| /payments/{id}/status | 30/min |
| /client-errors | 30/min |

Rate limit headers:
- `X-RateLimit-Limit`: Request limit
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Reset timestamp (Unix)

---

## Support

For technical support or questions:
- Email: support@cognit.online
- Documentation: https://cognit.online/docs
- GitHub Issues: [Link to repository]

---

## Changelog

### v1.0.0 (Current)
- Initial API release
- Participant registration and authentication
- Image-based survey system
- UPI payment integration
- Attention check validation
- Quality scoring algorithm
- Comprehensive error handling
- Rate limiting and security headers