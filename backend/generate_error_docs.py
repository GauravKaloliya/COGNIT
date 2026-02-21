#!/usr/bin/env python3
"""
Auto-generates error documentation from ERROR_CODES
Run: python generate_error_docs.py > ERROR_REFERENCE.md
"""

import sys
import os

# Add the current directory to the path to import app
sys.path.insert(0, os.path.dirname(__file__))

try:
    from app import ERROR_CODES
except ImportError:
    # If app.py is not directly importable, define a minimal ERROR_CODES structure
    ERROR_CODES = {
        # This is a fallback - the actual ERROR_CODES should be in app.py
        "SYS_001_0001": {"code": "SYS_001_0001", "status": 500, "message": "Database error occurred"},
        "VAL_003_0001": {"code": "VAL_003_0001", "status": 400, "message": "Please fill in all required fields"},
    }


def generate_docs():
    """Generate markdown documentation for error codes."""
    print("# COGNIT API Error Reference\n")
    print("Auto-generated error code documentation from backend ERROR_CODES.\n")
    print(f"Total error codes: {len(ERROR_CODES)}\n")
    
    # Group error codes by category
    categories = {}
    for key, val in ERROR_CODES.items():
        if key.startswith('_'):  # Skip private keys
            continue
            
        cat = key.split('_')[0] if '_' in key else 'UNKNOWN'
        if cat not in categories:
            categories[cat] = []
        categories[cat].append((key, val))
    
    # Generate documentation by category
    for cat in sorted(categories.keys()):
        errors = categories[cat]
        print(f"## {cat} Errors\n")
        print(f"Count: {len(errors)}\n")
        
        # Create table
        print("| Code | HTTP | Message | Field/Fields |")
        print("|------|------|---------|--------------|")
        
        # Sort errors by code for consistent output
        errors.sort(key=lambda x: x[1]['code'])
        
        for key, val in errors:
            field_info = ""
            if 'field' in val:
                field_info = val['field']
            elif 'fields' in val:
                field_info = f"multiple: {', '.join(val['fields'][:3])}{'...' if len(val['fields']) > 3 else ''}"
            
            print(f"| `{val['code']}` | {val['status']} | {val['message']} | {field_info} |")
        
        print()
        
        # Add category description
        descriptions = {
            'VAL': 'Validation errors occur when client input does not meet requirements.',
            'DUP': 'Duplicate errors occur when attempting to create resources that already exist.',
            'AUTH': 'Authentication/Authorization errors occur when access is denied.',
            'NF': 'Not Found errors occur when requested resources do not exist.',
            'PAY': 'Payment errors occur during payment processing.',
            'FRAUD': 'Fraud detection errors occur when payment screenshots fail validation.',
            'SYS': 'System errors occur due to internal server issues.',
            'RATE': 'Rate limit errors occur when too many requests are made.',
        }
        
        if cat in descriptions:
            print(f"{descriptions[cat]}\n")
    
    # Add usage examples
    print("## Usage Examples\n")
    print("### Backend Error Response\n")
    print("```json\n")
    print('{\n')
    print('  "success": false,\n')
    print('  "error": {\n')
    print('    "code": "VAL_002_0004",\n')
    print('    "message": "At least 60 words required (you wrote 23)",\n')
    print('    "category": "VAL",\n')
    print('    "field": "description"\n')
    print('  }\n')
    print('}\n')
    print("```\n")
    
    print("### Frontend Error Handling\n")
    print("```javascript\n")
    print("import { parseErrorResponse, getErrorMessage } from './utils/errorRegistry';\n")
    print("\n")
    print("try {\n")
    print("  const response = await api.post('/submit', data);\n")
    print("  // Handle success\n")
    print("} catch (error) {\n")
    print("  const parsedError = parseErrorResponse(error.response);\n")
    print("  console.error('Error code:', parsedError.code);\n")
    print("  console.error('User message:', parsedError.message);\n")
    print("  console.error('Category:', parsedError.category);\n")
    print("  console.error('Suggested action:', parsedError.action);\n")
    print("  \n")
    print("  // Show field-specific error if available\n")
    print("  if (parsedError.field) {\n")
    print("    showFieldError(parsedError.field, parsedError.message);\n")
    print("  }\n")
    print("}\n")
    print("```\n")
    
    print("### Error Categories and Actions\n")
    print("| Category | Severity | Suggested Action |")
    print("|----------|----------|------------------|")
    print("| VAL | warning | Fix input fields |")
    print("| DUP | warning | Change input values |")
    print("| AUTH | error | Re-authenticate or redirect |")
    print("| NF | error | Redirect or notify user |")
    print("| PAY | warning | Retry payment process |")
    print("| FRAUD | error | Retry with different input |")
    print("| SYS | error | Retry or contact support |")
    print("| RATE | warning | Wait and retry |")
    print()
    
    print("## Error Logging\n")
    print("All errors are automatically logged to the `error_log` table in the database for analysis.\n")
    print("Client-side errors can be logged via the `/client-errors` endpoint.\n")
    
    print("## Regenerating This Documentation\n")
    print("To regenerate this documentation, run:\n")
    print("```bash\n")
    print("python generate_error_docs.py > ERROR_REFERENCE.md\n")
    print("```\n")
    
    # Add footer
    print(f"\n---\n")
    print(f"Generated on: {__import__('datetime').datetime.now().isoformat()}\n")
    print(f"Total errors documented: {len(ERROR_CODES)}\n")


if __name__ == "__main__":
    generate_docs()