# Use official Python runtime as a parent image
FROM python:3.10-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
ENV HOST=0.0.0.0
ENV ENV=production

# Set working directory
WORKDIR /app

# Install system dependencies needed for building packages or running Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright and its system browser dependencies
RUN python -m playwright install chromium
RUN python -m playwright install-deps chromium

# Copy the rest of the application code
COPY . .

# Expose port
EXPOSE 8000

# Start server
CMD ["python", "server.py"]
