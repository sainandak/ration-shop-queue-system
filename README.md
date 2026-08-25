# 🌾 Smart Ration Card Token & Queue Management System

A production-ready Queue & Bilingual Voice Announcement System for Fair Price Shops (Ration Shops) built with Node.js, Express, and Socket.IO.

## 🚀 Features

- **📷 Camera QR Scanner**: Fast in-browser QR scanner using native HTML5 and `jsQR` (runs offline without CDN dependencies).
- **🗣️ Bilingual Voice Engine**: Web Speech API announces tokens in English + Telugu with a 2-tone chime bell for Bluetooth speakers.
- **📺 Outside Public Display**: Real-time Socket.IO sync showing big token numbers, cardholder names, village, and upcoming queue list.
- **📥 Excel / CSV Bulk Upload**: Upload rosters of 300+ cardholders with automatic Telugu Unicode parsing and instant preview.
- **➕ Smart Manual Entry**: Fast live auto-suggestions & auto-complete by name/RC number.
- **🖨️ Printable QR Generator**: Batch A4 sheet generator with dashed scissor lines for physical card distribution.
- **📦 1-Click QR Downloads**: Download single QR PNGs or all 300+ QR codes in a single `.zip` file.
- **📊 Daily Reports & PIN Reset**: Download daily served logs in Excel/CSV and reset queue with Admin PIN (`1234`).

## 🛠️ Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start server
npm start
```

Open in your browser:
- **Hub:** `http://localhost:3000`
- **Counter Scanner:** `http://localhost:3000/counter`
- **Outside Display:** `http://localhost:3000/display`
- **Admin Dashboard:** `http://localhost:3000/admin`
- **Printable QR Sheets:** `http://localhost:3000/print-qr`

## 🔒 Free HTTPS Deployment (For Native Mobile Camera)
Deploy to [Render.com](https://render.com) or [Railway.app](https://railway.app) by connecting your GitHub repository. Build command: `npm install`, Start command: `node server.js`.