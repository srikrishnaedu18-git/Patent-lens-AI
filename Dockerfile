# Stage 1: Build React Frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend-react
COPY frontend-react/package*.json ./
RUN npm install
COPY frontend-react/ ./
RUN npm run build

# Stage 2: Production Python API Server
FROM python:3.11-slim

# Environment
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
ENV HOST=0.0.0.0
ENV ENV=production
# Make all sub-packages (backend/, db/, ai/) importable from project root
ENV PYTHONPATH=/app

WORKDIR /app

# System deps (for Playwright chromium)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libatspi2.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxcb1 \
    libxkbcommon0 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browser
RUN python -m playwright install chromium

# Copy full application
COPY . .

# Copy built React frontend output from Stage 1 into frontend-react/dist
COPY --from=frontend-builder /app/frontend-react/dist ./frontend-react/dist

# Expose default port
EXPOSE 8000

# Production entrypoint
CMD ["sh", "-c", "uvicorn backend.server:app --host ${HOST} --port ${PORT} --workers 1"]
