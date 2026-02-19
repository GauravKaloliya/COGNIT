-- Migration to add payment_reference column to payments table
-- This fixes the missing column error

ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100) UNIQUE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_payments_payment_reference ON payments(payment_reference);