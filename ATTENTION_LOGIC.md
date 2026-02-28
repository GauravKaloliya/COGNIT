# Attention Logic in C.O.G.N.I.T.

This document explains the attention verification and quality control mechanisms implemented throughout the C.O.G.N.I.T. platform.

## Overview

C.O.G.N.I.T. uses a multi-layered attention verification system to ensure participants are providing genuine, high-quality responses. The system tracks attention through embedded checks within surveys and monitors engagement patterns throughout the user journey.

---

## Backend Attention Logic

### 1. Attention Check Mechanism (`backend/app/routes/submission.py`)

#### Attention Check Tables
- **`attention_checks`**: Stores attention check configurations for specific images
  - `image_id`: Reference to the image with an attention check
  - `expected_word`: The word/phrase that must appear in the description
  - `is_strict`: If `true`, requires exact word boundary match; if `false`, allows substring match
  - `is_active`: Whether this attention check is currently enabled

#### How Attention Checks Work
```python
# Check if the image has an attention check configured
ac_row = db.execute(text("""
    SELECT expected_word, is_strict
    FROM attention_checks
    WHERE image_id = :iid AND is_active = true
"""), {"iid": image_id_fk}).fetchone()

is_attention = ac_row is not None
attention_passed = None

if is_attention:
    expected = ac_row[0].strip().lower()
    strict = ac_row[1]
    dlow = description.lower()
    # Strict mode: word boundary matching
    # Non-strict mode: substring matching
    attention_passed = bool(re.search(rf"\b{re.escape(expected)}\b", dlow)) if strict else (expected in dlow)
```

### 2. Participant Attention Statistics (`participant_attention_stats` table)

The system maintains running statistics for each participant:

| Column | Description |
|--------|-------------|
| `total_checks` | Total number of attention checks encountered |
| `passed_checks` | Number of attention checks passed |
| `failed_checks` | Number of attention checks failed |
| `attention_score` | Ratio of passed_checks / total_checks |
| `is_flagged` | Whether the participant is flagged for low attention |

#### Flagging Logic
```python
# A participant is flagged when:
# 1. Their attention_score drops below ATTENTION_FLAG_THRESHOLD (default: 0.60)
# 2. AND they have at least ATTENTION_FLAG_MIN_CHECKS (default: 3) total checks

is_flagged = (attention_score < 0.60) AND (total_checks >= 3)
```

### 3. Configuration Constants (`backend/app/config.py`)

| Constant | Default | Description |
|----------|---------|-------------|
| `ATTENTION_FLAG_THRESHOLD` | 0.60 | Minimum attention score to avoid flagging |
| `ATTENTION_FLAG_MIN_CHECKS` | 3 | Minimum checks before flagging applies |
| `PRIORITY_ATTENTION_THRESHOLD` | 0.75 | Minimum attention score for priority eligibility |

### 4. Quality Score Calculation (`backend/app/utils/helpers.py`)

The quality score incorporates attention check results:

```python
def calculate_quality_score(word_count, attention_passed, time_spent, feedback_length, has_red_flags):
    score = 0.0
    # Word count contribution (up to 40 points)
    score += min(word_count / 10, 40)
    # Attention passed bonus (30 points)
    if attention_passed:
        score += 30
    # Time spent bonus (up to 20 points)
    if time_spent and time_spent > 30:
        score += min(time_spent / 10, 20)
    # Feedback length bonus (up to 10 points)
    score += min(feedback_length / 20, 10)
    return min(score, 100)
```

### 5. Submission Blocking

Participants flagged for low attention are blocked from submitting:

```python
flagged = db.execute(text("""
    SELECT is_flagged FROM participant_attention_stats
    WHERE participant_id = :pid
"""), {"pid": participant_id}).scalar()
if flagged:
    return create_error_response("FLAGGED_ACCOUNT")
```

### 6. Priority Eligibility

Attention scores affect priority status for reward allocation:

```python
# Priority eligibility requires:
# 1. 500+ total words OR 3+ survey rounds
# 2. AND attention_score >= 0.75

priority_eligible = (
    (total_words >= 500 OR survey_rounds >= 3)
    AND attention_score >= 0.75
)
```

---

## Frontend Attention Logic

### 1. Consent Page Warning (`frontend/src/pages/ConsentPage.jsx`)

The consent form explicitly warns participants about attention checks:

```jsx
<h3>Data Quality and Participation Integrity</h3>
<ul>
  <li>The platform uses automated systems to evaluate response completeness, 
      instruction compliance, timing consistency, and engagement patterns.</li>
  <li>Some surveys are designed to verify that instructions are being carefully followed.</li>
  <li>Repeated failure to follow instructions or patterns indicating inattentive 
      participation may result in temporary or permanent restriction from continuing the task.</li>
</ul>
```

### 2. Survey Page Engagement Tracking (`frontend/src/pages/SurveyPage.jsx`)

The frontend tracks several engagement metrics:

#### Tab Visibility Tracking
```javascript
const handleVisibilityChange = async () => {
  if (document.hidden && publicId) {
    setEngagementData(prev => ({
      ...prev,
      tabSwitchCount: prev.tabSwitchCount + 1
    }));
    await endpoints.trackEngagement({
      public_id: publicId,
      event_type: 'tab_switch'
    });
  }
};
```

#### Network Status Tracking
```javascript
const handleOffline = async () => {
  if (publicId) {
    setEngagementData(prev => ({
      ...prev,
      networkDisconnects: prev.networkDisconnects + 1
    }));
    await endpoints.trackEngagement({
      public_id: publicId,
      event_type: 'network_disconnect'
    });
  }
};
```

#### Page Close Attempt Tracking
```javascript
const handleBeforeUnload = async (e) => {
  if (publicId) {
    setEngagementData(prev => ({
      ...prev,
      pageCloseAttempts: prev.pageCloseAttempts + 1
    }));
    endpoints.trackEngagement({
      public_id: publicId,
      event_type: 'page_close_attempt'
    });
  }
};
```

### 3. Copy-Paste Prevention

To ensure original descriptions, copy-paste is disabled on the survey page:

```javascript
const preventCopyPaste = useCallback((e) => {
  e.preventDefault();
  return false;
}, []);

// Applied to description and comments textareas
descTextarea.addEventListener('copy', preventCopyPaste);
descTextarea.addEventListener('cut', preventCopyPaste);
descTextarea.addEventListener('paste', preventCopyPaste);
```

### 4. Attention Check Feedback

When a participant fails an attention check, they receive feedback:

```javascript
if (result.attention_passed === false) {
  addToast("Please follow the special instructions next time!", "warning");
}
```

---

## Engagement Tracking Endpoint

### Endpoint: `/engagement/track`

Records engagement events in the participant's metadata:

```python
# Allowed event types
allowed_events = ["tab_switch", "page_close_attempt", "network_disconnect"]

# Stored in participants.extra_metadata under "engagement_tracking"
{
  "engagement_tracking": {
    "tab_switches": 0,
    "page_close_attempts": 0,
    "network_disconnects": 0,
    "total_events": 0,
    "events": [
      {"type": "tab_switch", "timestamp": "2024-01-15T10:30:00Z"}
    ]
  }
}
```

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    PARTICIPANT JOURNEY                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. CONSENT PAGE                                                │
│     └── Warning about attention checks                          │
│                                                                 │
│  2. USER DETAILS PAGE                                           │
│     └── Account creation                                        │
│                                                                 │
│  3. PAYMENT PAGE                                                │
│     └── Payment verification                                    │
│                                                                 │
│  4. SURVEY PAGE                                                 │
│     ├── Engagement tracking (tab switches, disconnects)         │
│     ├── Copy-paste prevention                                   │
│     ├── Description submission                                  │
│     └── Attention check validation                              │
│          ├── Pass: attention_passed = true                      │
│          └── Fail: attention_passed = false                     │
│                                                                 │
│  5. SUBMISSION PROCESSING                                       │
│     ├── Check for attention check images                        │
│     ├── Validate expected word presence                         │
│     ├── Update participant_attention_stats                      │
│     │    ├── Increment total_checks                             │
│     │    ├── Increment passed_checks or failed_checks           │
│     │    ├── Recalculate attention_score                        │
│     │    └── Set is_flagged if threshold crossed                │
│     ├── Calculate quality_score                                 │
│     └── Update priority_eligible status                         │
│                                                                 │
│  6. FLAGGED ACCOUNT CHECK                                       │
│     └── If is_flagged = true → Block future submissions         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Configuration Summary

| Setting | Value | Location |
|---------|-------|----------|
| Minimum attention score to avoid flagging | 60% | `ATTENTION_FLAG_THRESHOLD` |
| Minimum checks before flagging | 3 | `ATTENTION_FLAG_MIN_CHECKS` |
| Minimum attention for priority status | 75% | `PRIORITY_ATTENTION_THRESHOLD` |
| Minimum words for priority | 500 | `PRIORITY_WORD_THRESHOLD` |
| Minimum rounds for priority | 3 | `PRIORITY_ROUNDS_THRESHOLD` |

---

## Best Practices for Adding Attention Checks

1. **Choose natural expected words**: Words that would naturally appear in a genuine description
2. **Use strict mode sparingly**: Only for specific, unambiguous words
3. **Balance difficulty**: Too easy = no value; too hard = false positives
4. **Monitor statistics**: Track pass rates and adjust thresholds if needed
5. **Avoid obvious patterns**: Don't make attention checks too predictable

---

## Error Handling

When a participant is flagged:
- Error code: `AUTH_001_0002`
- Message: "Your account has been flagged. Contact support."
- HTTP Status: 403 Forbidden

The participant should contact `research@cognit.online` for review.
