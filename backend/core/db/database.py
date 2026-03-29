from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from urllib.parse import urlparse

DATABASE_URL = os.environ.get("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("No DATABASE_URL found in environment variables")

# Parse the URL to determine the dialect
parsed_url = urlparse(DATABASE_URL)
scheme = parsed_url.scheme

connect_args = {}
pool_kwargs = {}

if scheme.startswith("sqlite"):
    # SQLite only needs one connection per thread by default, or special args for multi-threading
    connect_args = {"check_same_thread": False}
else:
    # MySQL / PostgreSQL connection pool settings
    pool_kwargs = {
        "pool_pre_ping": True,
        "pool_recycle": 3600,
        "pool_size": 10,
        "max_overflow": 20
    }

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    **pool_kwargs
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
