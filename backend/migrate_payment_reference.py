#!/usr/bin/env python3
"""
Migration script to add the missing payment_reference column to the payments table.
This fixes the error: column "payment_reference" does not exist

Usage:
    python migrate_payment_reference.py
    # or with a specific DATABASE_URL:
    DATABASE_URL=postgresql://... python migrate_payment_reference.py
"""

import os
import sys
from pathlib import Path

# Add the current directory to the path so we can import from app.py
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import create_engine, text

# Import DATABASE_URL from app.py
from app import DATABASE_URL

def main():
    """Add the missing payment_reference column to the payments table."""
    print("=" * 60)
    print("Migration: Add payment_reference column to payments table")
    print("=" * 60)
    
    # Create SQLAlchemy engine
    print(f"\nConnecting to database...")
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
    
    try:
        with engine.connect() as conn:
            # Check if the column already exists
            result = conn.execute(text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'payments' 
                    AND column_name = 'payment_reference'
                )
            """))
            
            column_exists = result.scalar()
            
            if column_exists:
                print("✓ Column 'payment_reference' already exists in payments table")
                return 0
            
            print("Column 'payment_reference' not found. Adding it now...")
            
            # Add the column
            conn.execute(text("""
                ALTER TABLE payments 
                ADD COLUMN payment_reference VARCHAR(100) UNIQUE
            """))
            print("✓ Added payment_reference column")
            
            # Create index for faster lookups
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_payments_payment_reference 
                ON payments(payment_reference)
            """))
            print("✓ Created index for payment_reference")
            
            # Commit the changes
            conn.commit()
            print("\n✓ Migration completed successfully!")
            
            # Verify the column was added
            result = conn.execute(text("""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'payments' AND column_name = 'payment_reference'
            """))
            
            row = result.fetchone()
            if row:
                print(f"✓ Verified: Column '{row[0]}' with type '{row[1]}' added successfully")
            
            return 0
            
    except Exception as e:
        print(f"✗ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())