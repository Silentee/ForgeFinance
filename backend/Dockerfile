FROM python:3.12-slim

WORKDIR /app

# Install uv for dependency management
RUN pip install --no-cache-dir uv

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock* ./

# Install dependencies
RUN uv sync --frozen --no-dev --no-editable 2>/dev/null || uv sync --no-dev --no-editable

# Copy application code
COPY . .

# Create data directory for mounted volume
RUN mkdir -p /data/uploads

# Environment defaults (overridable via docker-compose)
ENV DATABASE_URL=sqlite:////data/app.db
ENV CSV_UPLOAD_DIR=/data/uploads

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
