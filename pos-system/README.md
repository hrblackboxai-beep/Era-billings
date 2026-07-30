# Offline POS System - Product Requirements

## Overview
A comprehensive Point of Sale (POS) system designed to work completely offline with all the features mentioned.

## Architecture
- **Frontend**: HTML/CSS/JavaScript with local storage
- **Backend**: Python Flask (runs locally)
- **Database**: SQLite (offline, file-based)
- **Deployment**: Runs on local machine/server

## Features Implemented

### 1. Billing Module
- GST Billing with tax calculations
- Barcode scanning support
- Discount management (item-level and bill-level)
- Invoice printing
- Split bills functionality

### 2. Kitchen Management
- Kitchen Order Tickets (KOT)
- Kitchen Display System
- Order status tracking

### 3. Inventory Management
- Stock management
- Purchase management
- Low stock alerts
- Waste tracking

### 4. Payment Methods
- UPI integration
- Credit Card
- Debit Card
- Cash
- Digital Wallets

### 5. Customer Management
- Loyalty points system
- Membership management
- Customer purchase history
- Birthday offers automation

### 6. Employee Management
- Login with roles
- Attendance tracking
- Salary tracking
- Performance reports

### 7. Reports
- Daily sales reports
- Weekly sales reports
- Monthly sales reports
- Profit reports
- Tax reports

### 8. Cloud Features (Optional Sync)
- Automatic backup
- Multi-branch management
- Mobile dashboard
- Live reports

### 9. AI Features (Future Expansion)
- Sales prediction
- Best selling items analysis
- Inventory forecasting
- Customer purchase pattern analysis
- AI business assistant
- Automatic reorder suggestions

## Installation

```bash
cd pos-system
pip install -r requirements.txt
python app.py
```

Access the application at: `http://localhost:5000`

## Offline Capability
The entire system runs locally without requiring internet connection. All data is stored in a local SQLite database.
