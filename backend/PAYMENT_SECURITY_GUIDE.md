# Payment Security Implementation Guide

## Current State

The `/payment/confirm` endpoint has been enhanced with:
- Stricter transaction_id validation (10-100 alphanumeric chars, hyphens, underscores)
- Amount validation (must be positive)
- Gateway validation (max 50 chars)
- FOR UPDATE locking on participant row
- Better audit logging

## Remaining Security Requirements

The current implementation does **NOT** include webhook signature verification from payment gateways. This is a critical security requirement for production use.

## Implementation Examples by Payment Gateway

### 1. Razorpay (Common in India)

```python
import hashlib
import hmac
from flask import request

@app.route("/payment/webhook", methods=["POST"])
def razorpay_webhook():
    # Get webhook secret from environment
    webhook_secret = os.getenv("RAZORPAY_WEBHOOK_SECRET")

    # Get signature from headers
    received_signature = request.headers.get("X-Razorpay-Signature")

    if not received_signature:
        return jsonify({"error": "Missing signature"}), 400

    # Calculate expected signature
    webhook_body = request.get_data(as_text=True)
    expected_signature = hmac.new(
        webhook_secret.encode(),
        webhook_body.encode(),
        hashlib.sha256
    ).hexdigest()

    # Verify signature
    if not hmac.compare_digest(expected_signature, received_signature):
        return jsonify({"error": "Invalid signature"}), 401

    # Process webhook
    payload = request.get_json()
    event_type = payload.get("event")

    if event_type == "payment.captured":
        payment_entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
        # Extract payment details
        transaction_id = payment_entity.get("id")
        amount = payment_entity.get("amount") / 100  # Convert to rupees
        status = payment_entity.get("status")

        if status == "captured":
            # Update participant payment status
            db = get_db()
            db.execute(
                text("""
                    UPDATE participants
                    SET payment_status = 'paid'
                    WHERE participant_id = :participant_id
                """),
                {"participant_id": payment_entity.get("notes", {}).get("participant_id")}
            )
            db.commit()

    return jsonify({"status": "ok"}), 200
```

### 2. Stripe

```python
import stripe

@app.route("/payment/webhook", methods=["POST"])
def stripe_webhook():
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    payload = request.get_data(as_text=True)
    sig_header = request.headers.get("Stripe-Signature")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, webhook_secret
        )
    except ValueError:
        return jsonify({"error": "Invalid payload"}), 400
    except stripe.error.SignatureVerificationError:
        return jsonify({"error": "Invalid signature"}), 401

    if event["type"] == "payment_intent.succeeded":
        payment_intent = event["data"]["object"]
        # Process successful payment
        transaction_id = payment_intent["id"]
        amount = payment_intent["amount"] / 100
        # Update participant

    return jsonify({"status": "ok"}), 200
```

### 3. PayPal

```python
import requests
import json

@app.route("/payment/webhook", methods=["POST"])
def paypal_webhook():
    # Get PayPal webhook URL based on environment
    webhook_url = os.getenv("PAYPAL_WEBHOOK_VERIFY_URL")

    # Get headers
    transmission_id = request.headers.get("PayPal-Transmission-Id")
    cert_url = request.headers.get("PayPal-Cert-Url")
    auth_algo = request.headers.get("PayPal-Auth-Algo")
    transmission_sig = request.headers.get("PayPal-Transmission-Sig")
    transmission_time = request.headers.get("PayPal-Transmission-Time")

    # Prepare verification payload
    webhook_id = os.getenv("PAYPAL_WEBHOOK_ID")
    payload = {
        "transmission_id": transmission_id,
        "cert_url": cert_url,
        "auth_algo": auth_algo,
        "transmission_sig": transmission_sig,
        "transmission_time": transmission_time,
        "webhook_id": webhook_id,
        "webhook_event": request.get_json()
    }

    # Verify with PayPal
    response = requests.post(webhook_url, json=payload)
    verification_result = response.json()

    if verification_result.get("verification_status") != "SUCCESS":
        return jsonify({"error": "Invalid webhook"}), 401

    # Process webhook
    event_data = request.get_json()
    # Handle payment completion

    return jsonify({"status": "ok"}), 200
```

## Idempotency Keys

To prevent duplicate payment processing, add idempotency support:

```python
@app.route("/payment/confirm", methods=["POST"])
@limiter.limit("30 per minute")
@track_performance
def confirm_payment():
    data = request.get_json(silent=True) or {}
    participant_id = data.get("participant_id")
    transaction_id = data.get("transaction_id", "").strip()
    idempotency_key = request.headers.get("Idempotency-Key")

    # Validate idempotency key
    if idempotency_key:
        # Check if this transaction was already processed
        existing = db.execute(
            text("""
                SELECT id FROM participants
                WHERE participant_id = :participant_id
                AND payment_metadata->>'idempotency_key' = :idempotency_key
            """),
            {"participant_id": participant_id, "idempotency_key": idempotency_key}
        ).fetchone()

        if existing:
            return jsonify({"status": "already_confirmed", "message": "Transaction already processed"}), 200

    # ... rest of payment confirmation logic ...
```

## Environment Variables Required

Add these to your `.env` file:

```
# For Razorpay
RAZORPAY_WEBHOOK_SECRET=webhook_secret_from_razorpay_dashboard
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_key_secret

# For Stripe
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_SECRET_KEY=sk_live_your_secret_key

# For PayPal
PAYPAL_WEBHOOK_ID=your_webhook_id
PAYPAL_WEBHOOK_VERIFY_URL=https://api-m.paypal.com/v1/notifications/verify-webhook-signature
PAYPAL_CLIENT_ID=your_client_id
PAYPAL_CLIENT_SECRET=your_client_secret
```

## Testing Webhooks Locally

Use tools like ngrok or localtunnel to test webhooks locally:

```bash
# Using ngrok
ngrok http 5000

# Then register the ngrok URL in your payment gateway's webhook settings
```

## Security Best Practices

1. **Always verify webhook signatures** before processing payments
2. **Use HTTPS** for all webhook endpoints
3. **Validate all payment amounts** against your records
4. **Implement idempotency** to prevent double-charging
5. **Log all webhook events** for audit trails
6. **Monitor for suspicious activity** (failed signature verifications)
7. **Store webhook secrets securely** using environment variables or secrets managers
8. **Rotate webhook secrets** periodically
9. **Use different secrets** for development and production

## Database Schema Addition

Consider adding a payment transactions table for better tracking:

```sql
CREATE TABLE payment_transactions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_fk BIGINT NOT NULL,
    participant_id VARCHAR(100) NOT NULL,
    transaction_id VARCHAR(255) UNIQUE NOT NULL,
    gateway VARCHAR(50) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    status VARCHAR(50) NOT NULL,
    payment_method VARCHAR(100),
    gateway_response JSONB,
    idempotency_key VARCHAR(255),
    processed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (participant_fk) REFERENCES participants(id) ON DELETE CASCADE
);

CREATE INDEX idx_payment_transactions_participant ON payment_transactions(participant_fk);
CREATE INDEX idx_payment_transactions_transaction_id ON payment_transactions(transaction_id);
CREATE INDEX idx_payment_transactions_status ON payment_transactions(status);
```

## Implementation Priority

1. **High Priority**: Webhook signature verification (security critical)
2. **High Priority**: Idempotency keys (prevent double-charging)
3. **Medium Priority**: Payment transactions table (better tracking)
4. **Low Priority**: Enhanced logging and monitoring

## Further Reading

- [Razorpay Webhooks](https://razorpay.com/docs/webhooks/)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [PayPal Webhooks](https://developer.paypal.com/docs/api-basics/notifications/webhooks/)
- [OWASP Payment Security](https://owasp.org/www-project-payment-security/)
