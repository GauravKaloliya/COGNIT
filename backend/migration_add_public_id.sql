-- =====================================================
-- Migration: Add public_id column to participants table
-- Version: 7.0.0
-- =====================================================
-- This migration adds the public_id column if it doesn't exist
-- Fixes: column "public_id" of relation "participants" does not exist

-- Add public_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'participants' 
        AND column_name = 'public_id'
    ) THEN
        ALTER TABLE participants ADD COLUMN public_id UUID DEFAULT gen_random_uuid() UNIQUE;
        
        -- Update existing rows to have a public_id
        UPDATE participants SET public_id = gen_random_uuid() WHERE public_id IS NULL;
        
        -- Make the column NOT NULL after populating existing data
        ALTER TABLE participants ALTER COLUMN public_id SET NOT NULL;
        
        RAISE NOTICE 'public_id column added to participants table';
    ELSE
        RAISE NOTICE 'public_id column already exists in participants table';
    END IF;
END $$;

-- Create index on public_id if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_participants_public_id ON participants (public_id);
