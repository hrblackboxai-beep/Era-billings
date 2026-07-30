#!/bin/bash

# Offline POS System Startup Script

echo "======================================"
echo "  🏪 Offline POS System"
echo "======================================"
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

echo "✓ Python found: $(python3 --version)"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo ""
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo ""
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo ""
echo "📥 Installing dependencies..."
pip install -r requirements.txt

# Create database directory if it doesn't exist
mkdir -p database

# Start the application
echo ""
echo "======================================"
echo "  🚀 Starting POS System..."
echo "======================================"
echo ""
echo "Access the application at: http://localhost:5000"
echo ""
echo "Default Login Credentials:"
echo "  Username: admin"
echo "  Password: admin123"
echo ""
echo "Press Ctrl+C to stop the server"
echo "======================================"
echo ""

python app.py
