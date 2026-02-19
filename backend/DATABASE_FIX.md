# Database Fix: Missing payment_reference Column

## Problem
The `/payment/upi-details` endpoint is failing with the error:
```
psycopg2.errors.UndefinedColumn: column "payment_reference" does not exist
LINE 2:         SELECT payment_reference, status FROM payments
```

## Root Cause
The database `payments` table is missing the `payment_reference` column. This occurred because:
- The column was added in a recent schema update (commit e758332) 
- Existing databases were not migrated to include the new column
- The column is referenced in code at line 796 of `app.py` but doesn't exist in the DB

This is a **schema mismatch issue** - the application code expects a column that exists in the schema file but not in the current database.

## Solution

### Option 1: Initialize/Reset Database (Recommended for Development)
If you can recreate the database, run the full schema:

```bash
cd backend
psql "$DATABASE_URL" -f schema.sql
```

### Option 2: Migrate Existing Database (Recommended for Production)
If you need to keep existing data, add only the missing column:

```bash
cd backend
psql "$DATABASE_URL" -f fix_payment_reference_column.sql
```

Or, if you have psql access:

```sql
-- Add the missing column
ALTER TABLE payments 
ADD COLUMN payment_reference VARCHAR(100) UNIQUE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_payments_payment_reference ON payments(payment_reference);
```

### Option 3: Run Migration Script (Python)
If you have Python access and DATABASE_URL set:

```bash
cd backend
python migrate_payment_reference.py
```

## Verification

After running the migration, verify the column exists:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'payments' AND column_name = 'payment_reference';
```

You should see:
```
column_name      | data_type
-----------------+-----------
payment_reference| varchar
```

## Files Created
- `fix_payment_reference_column.sql` - SQL to add the missing column
- `migrate_payment_reference.py` - Python script to run the migration
- This README file - Documentation

## Notes
- The `payment_reference` column is already defined in `schema.sql` (line 48)
- This fix ensures the database schema matches what the application expects
- The column has a UNIQUE constraint and should be indexed for performance