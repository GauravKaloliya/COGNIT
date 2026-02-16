#!/usr/bin/env python3
"""
Database initialization script for C.O.G.N.I.T. PostgreSQL database
This script should be run once to set up the database schema on Neon or other PostgreSQL instances.

Usage:
  python init_db.py                    # Initialize with DATABASE_URL from environment
  python init_db.py <connection-url>   # Initialize with provided connection URL

Environment Variables:
  DATABASE_URL - PostgreSQL connection string
"""

import os
import sys
from pathlib import Path
from sqlalchemy import create_engine, text

def get_database_url():
    """Get database URL from environment or command line"""
    if len(sys.argv) > 1:
        return sys.argv[1]
    
    url = os.getenv("DATABASE_URL")

    if not url:
        print("Error: DATABASE_URL environment variable is required")
        sys.exit(1)
    
    # Fix for SQLAlchemy (some providers use postgres:// instead of postgresql://)
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    
    return url

def verify_database(engine):
    """Verify that the database was initialized correctly"""
    print("\nVerifying database...")
    
    required_tables = [
        'participants',
        'consent_records',
        'submissions',
        'images',
        'payments',
        'audit_log',
        'performance_metrics'
    ]
    
    with engine.connect() as conn:
        for table_name in required_tables:
            result = conn.execute(text(
                "SELECT EXISTS (SELECT FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = :table_name)"
            ), {"table_name": table_name})
            
            exists = result.scalar()
            if exists:
                print(f"✓ Table '{table_name}' exists")
            else:
                print(f"✗ Table '{table_name}' NOT found")
                return False
    
    print("\n✓ Database verification passed!")
    return True

def populate_images(engine):
    """Populate images table with all images from the images folder"""
    print("\nPopulating images table...")

    script_dir = Path(__file__).resolve().parent
    images_dir = script_dir / "images"

    if not images_dir.exists():
        print(f"⚠ Images directory not found at {images_dir}")
        return True

    image_files = []

    # Find all SVG files in the images directory and subdirectories
    for image_path in images_dir.rglob("*.svg"):
        # Create image_id relative to images directory
        rel_path = image_path.relative_to(images_dir)
        image_id = str(rel_path)

        image_files.append({
            "image_id": image_id,
            "difficulty_score": 5.0,
            "object_count": 1,
            "width": 800,
            "height": 600
        })

    if not image_files:
        print("⚠ No image files found in images directory")
        return True

    print(f"Found {len(image_files)} image files")

    # Insert images into database
    with engine.connect() as conn:
        inserted = 0
        skipped = 0

        for image_data in image_files:
            try:
                conn.execute(text('''
                    INSERT INTO images
                    (image_id, difficulty_score, object_count, width, height)
                    VALUES (:image_id, :difficulty_score, :object_count, :width, :height)
                    ON CONFLICT (image_id) DO NOTHING
                '''), image_data)
                inserted += 1
            except Exception as e:
                skipped += 1
                print(f"✗ Failed to insert {image_data['image_id']}: {e}")

        conn.commit()
        print(f"✓ Inserted {inserted} images into database")
        if skipped > 0:
            print(f"⚠ Skipped {skipped} images (already exist or failed)")

    return True


def main():
    """Main initialization function - verifies DB and populates images only"""
    print("=" * 60)
    print("C.O.G.N.I.T. Database Verification & Image Population")
    print("=" * 60)
    
    # Get database URL
    database_url = get_database_url()
    print(f"\nConnecting to database...")
    print(f"URL: {database_url.split('@')[0]}@***")  # Hide password in output
    
    # Create engine
    try:
        engine = create_engine(
            database_url,
            pool_pre_ping=True,
            echo=False
        )
        
        # Test connection
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version()"))
            version = result.scalar()
            print(f"✓ Connected to: {version.split(',')[0]}")
        
    except Exception as e:
        print(f"✗ Failed to connect to database: {e}")
        sys.exit(1)
    
    # Populate images from folder
    populate_images(engine)
    
    # Verify database
    if verify_database(engine):
        print("\n" + "=" * 60)
        print("✓ Database verification passed!")
        print("=" * 60)
        return 0
    else:
        print("\n" + "=" * 60)
        print("✗ Database verification failed")
        print("=" * 60)
        return 1

if __name__ == "__main__":
    sys.exit(main())
