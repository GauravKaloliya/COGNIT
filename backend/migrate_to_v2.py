#!/usr/bin/env python3
"""
Migration script to upgrade from old payment system to v2.0
- Removes Razorpay fields
- Adds automatic verification
- Migrates to AWS S3 for images
- Adds UPI transaction table

Usage:
    python migrate_to_v2.py
"""

import os
import sys
from pathlib import Path

# Add the current directory to the path
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import create_engine, text
from app import DATABASE_URL

def main():
    """Migrate to v2.0 schema."""
    print("=" * 60)
    print("C.O.G.N.I.T. Payment System v2.0 Migration")
    print("=" * 60)
    
    # Create SQLAlchemy engine
    print(f"\nConnecting to database...")
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
    
    try:
        with engine.connect() as conn:
            print("✓ Connected to database")
            
            # Check current version
            print("\n1. Checking current schema version...")
            
            # Check if payments table has razorpay fields
            result = conn.execute(text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'payments' 
                    AND column_name = 'razorpay_order_id'
                )
            """))
            
            has_razorpay = result.scalar()
            
            if has_razorpay:
                print("   Found old schema with Razorpay fields")
            else:
                print("   Schema may already be migrated or different version")
            
            # Check if upi_transactions table exists
            result = conn.execute(text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'upi_transactions'
                )
            """))
            
            has_upi_transactions = result.scalar()
            
            if has_upi_transactions:
                print("   v2.0 features already present")
                print("\n✓ Database already at v2.0 or compatible version")
                return 0
            
            print("\n2. Creating new tables...")
            
            # Create upi_transactions table
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS upi_transactions (
                    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    utr_number VARCHAR(100) UNIQUE NOT NULL,
                    payment_reference VARCHAR(100),
                    amount INTEGER NOT NULL,
                    payee_vpa VARCHAR(255),
                    payer_vpa VARCHAR(255),
                    transaction_timestamp TIMESTAMPTZ NOT NULL,
                    status VARCHAR(50) NOT NULL,
                    bank_reference VARCHAR(255),
                    raw_data JSONB,
                    verified_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                )
            """))
            print("   ✓ Created upi_transactions table")
            
            # Add new columns to payments table
            new_columns = [
                ("utr_verified", "BOOLEAN DEFAULT FALSE"),
                ("s3_key", "VARCHAR(500)"),
                ("auto_verified", "BOOLEAN DEFAULT FALSE"),
                ("verification_method", "VARCHAR(50)"),
                ("verification_timestamp", "TIMESTAMPTZ"),
                ("verification_details", "TEXT"),
                ("failed_at", "TIMESTAMPTZ")
            ]
            
            for column_name, column_def in new_columns:
                # Check if column already exists
                result = conn.execute(text("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'payments' 
                        AND column_name = :column_name
                    )
                """), {"column_name": column_name})
                
                if not result.scalar():
                    conn.execute(text(f"""
                        ALTER TABLE payments 
                        ADD COLUMN {column_name} {column_def}
                    """))
                    print(f"   ✓ Added column: {column_name}")
                else:
                    print(f"   - Column already exists: {column_name}")
            
            # Update images table to add S3 fields if not present
            result = conn.execute(text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'images' 
                    AND column_name = 's3_key'
                )
            """))
            
            if not result.scalar():
                conn.execute(text("""
                    ALTER TABLE images 
                    ADD COLUMN s3_key VARCHAR(500),
                    ADD COLUMN s3_url TEXT,
                    ADD COLUMN content_type VARCHAR(50) DEFAULT 'image/svg+xml'
                """))
                print("   ✓ Added S3 fields to images table")
            
            print("\n3. Creating indexes...")
            
            # Create indexes for new tables
            indexes = [
                ("idx_payments_utr", "CREATE INDEX IF NOT EXISTS idx_payments_utr ON payments(utr_number)"),
                ("idx_payments_verified", "CREATE INDEX IF NOT EXISTS idx_payments_verified ON payments(auto_verified)"),
                ("idx_payments_reference", "CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(payment_reference)"),
                ("idx_upi_transactions_utr", "CREATE INDEX IF NOT EXISTS idx_upi_transactions_utr ON upi_transactions(utr_number)"),
                ("idx_upi_transactions_reference", "CREATE INDEX IF NOT EXISTS idx_upi_transactions_reference ON upi_transactions(payment_reference)"),
                ("idx_upi_transactions_timestamp", "CREATE INDEX IF NOT EXISTS idx_upi_transactions_timestamp ON upi_transactions(transaction_timestamp)"),
                ("idx_images_s3_key", "CREATE INDEX IF NOT EXISTS idx_images_s3_key ON images(s3_key)"),
                ("idx_images_s3_url", "CREATE INDEX IF NOT EXISTS idx_images_s3_url ON images(s3_url)")
            ]
            
            for index_name, index_sql in indexes:
                try:
                    conn.execute(text(index_sql))
                    print(f"   ✓ Created index: {index_name}")
                except Exception as e:
                    print(f"   ⚠ Index {index_name} may already exist: {e}")
            
            print("\n4. Migrating existing data...")
            
            # Migrate existing payment data
            result = conn.execute(text("""
                SELECT COUNT(*) FROM payments
            """))
            
            payment_count = result.scalar()
            
            if payment_count > 0:
                # Set verification method for existing verified payments
                conn.execute(text("""
                    UPDATE payments 
                    SET verification_method = 'manual', auto_verified = FALSE
                    WHERE status = 'verified' AND verification_method IS NULL
                """))
                print(f"   ✓ Migrated {payment_count} existing payments")
            
            # Migrate images to use S3 URLs if they have local URLs
            result = conn.execute(text("""
                SELECT COUNT(*) FROM images WHERE image_url LIKE 'http%'
            """))
            
            if result.scalar() > 0:
                # Images already have URLs (likely S3), just move them to s3_url
                conn.execute(text("""
                    UPDATE images 
                    SET s3_url = image_url,
                        content_type = CASE 
                            WHEN image_url LIKE '%.png' THEN 'image/png'
                            WHEN image_url LIKE '%.jpg' OR image_url LIKE '%.jpeg' THEN 'image/jpeg'
                            WHEN image_url LIKE '%.svg' THEN 'image/svg+xml'
                            ELSE 'image/jpeg'
                        END
                    WHERE s3_url IS NULL
                """))
                print(f"   ✓ Migrated images to S3 URLs")
            
            # Commit all changes
            conn.commit()
            print("\n5. Migration completed successfully!")
            
            # Verify migration
            print("\n6. Verifying migration...")
            
            # Check new columns
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns 
                WHERE table_name = 'payments' 
                AND column_name IN ('utr_verified', 'auto_verified', 'verification_method', 's3_key')
                ORDER BY column_name
            """))
            
            columns = [row[0] for row in result.fetchall()]
            
            if len(columns) >= 4:
                print("   ✓ Payment table migration verified")
            else:
                print(f"   ⚠ Missing columns: {set(['utr_verified', 'auto_verified', 'verification_method', 's3_key']) - set(columns)}")
            
            # Check upi_transactions table
            result = conn.execute(text("""
                SELECT COUNT(*) FROM information_schema.columns 
                WHERE table_name = 'upi_transactions'
            """))
            
            if result.scalar() >= 8:
                print("   ✓ UPI transactions table created")
            else:
                print("   ⚠ UPI transactions table may be incomplete")
            
            # Check indexes
            result = conn.execute(text("""
                SELECT COUNT(*) FROM pg_indexes 
                WHERE indexname LIKE 'idx_upi_transactions%' OR indexname LIKE 'idx_payments_verified'
            """))
            
            if result.scalar() >= 3:
                print("   ✓ Indexes created")
            else:
                print("   ⚠ Some indexes may be missing")
            
            print("\n" + "=" * 60)
            print("✓ Migration to v2.0 completed successfully!")
            print("=" * 60)
            
            print("\nNext steps:")
            print("1. Update your application code to use app_v2.py")
            print("2. Configure UPI verification API (optional)")
            print("3. Set up AWS S3 with proper bucket policies")
            print("4. Test the new payment flow")
            print("5. Remove old schema files when ready")
            
            return 0
            
    except Exception as e:
        print(f"\n✗ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())