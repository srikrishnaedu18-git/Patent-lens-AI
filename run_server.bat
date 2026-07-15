@echo off
REM ------------------------------------------------------------
REM PatentLens Studio - Local Development Starter Script
REM ------------------------------------------------------------

REM Create virtual environment if it does not exist
if not exist venv (
    echo Creating virtual environment...
    py -m venv venv
)

REM Activate the virtual environment
call venv\Scripts\activate

REM Upgrade pip for reliability
py -m pip install --upgrade pip

REM Install py dependencies
pip install -r requirements.txt

REM Install Playwright Chromium browser (required for scraping)
py -m playwright install chromium

REM Launch the FastAPI server with live reload
py -m uvicorn server:app --host 127.0.0.1 --port 8000 --reload
