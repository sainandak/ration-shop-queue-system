const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const xlsx = require('xlsx');
const QRCode = require('qrcode');
const cors = require('cors');
const JSZip = require('jszip');
const selfsigned = require('selfsigned');

const app = express();
const httpServer = http.createServer(app);

// Generate self-signed SSL certificate for Mobile HTTPS Camera access
let httpsServer = null;
let sslPems = null;
try {
  const attrs = [{ name: 'commonName', value: 'RationQueueLocal' }];
  sslPems = selfsigned.generate(attrs, { days: 365 });
  httpsServer = https.createServer({ key: sslPems.private, cert: sslPems.cert }, app);
} catch (e) {
  console.log('HTTPS setup note:', e.message);
}

const io = new Server({ cors: { origin: '*' } });
io.attach(httpServer);
if (httpsServer) io.attach(httpsServer);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Storage paths
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const CARDS_FILE = path.join(DATA_DIR, 'cards.json');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Helper functions for data persistence
function loadJson(file, defaultVal) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading ' + file + ':', err.message);
  }
  return defaultVal;
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving ' + file + ':', err.message);
  }
}

// In-memory data store with file sync
let cards = loadJson(CARDS_FILE, []);
let queueState = loadJson(QUEUE_FILE, {
  tokenNo: 0,
  currentToken: null,
  queue: [],
  history: []
});
let settings = loadJson(SETTINGS_FILE, {
  shopName: 'Fair Price Shop (#03)',
  village: 'Gram Panchayat',
  adminPin: '1234',
  autoAnnounceOnScan: true,
  chimeEnabled: true,
  speechRate: 0.9
});

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['localhost'];
}

// Multer for Excel file upload
const upload = multer({ dest: UPLOADS_DIR });

app.enable('trust proxy');

// ==========================================
// API ROUTES
// ==========================================

// Get network information & pairing QR (Supports both Local Wi-Fi & Live Render Domain)
app.get('/api/network-info', async (req, res) => {
  const host = req.get('host') || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const isCloud = !host.includes('localhost') && !host.includes('127.0.0.1') && !host.startsWith('192.168.') && !host.startsWith('10.');
  
  const liveUrl = `${proto}://${host}`;
  const port = process.env.PORT || 3000;
  const httpsPort = 3443;
  const ips = getLocalIpAddresses();
  const primaryIp = ips[0] || 'localhost';

  const baseUrl = isCloud ? liveUrl : `http://${primaryIp}:${port}`;
  const httpsBaseUrl = isCloud ? liveUrl : `https://${primaryIp}:${httpsPort}`;

  try {
    const counterQr = await QRCode.toDataURL(`${httpsBaseUrl}/counter`);
    const displayQr = await QRCode.toDataURL(`${baseUrl}/display`);
    const homeQr = await QRCode.toDataURL(baseUrl);

    res.json({
      port,
      isCloud,
      liveUrl,
      ips,
      primaryIp,
      baseUrl,
      httpsBaseUrl,
      urls: {
        home: baseUrl,
        homeHttps: httpsBaseUrl,
        counter: `${httpsBaseUrl}/counter`,
        display: `${baseUrl}/display`,
        admin: `${baseUrl}/admin`
      },
      qrcodes: {
        home: homeQr,
        counter: counterQr,
        display: displayQr
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings API
app.get('/api/settings', (req, res) => {
  res.json({
    shopName: settings.shopName,
    village: settings.village,
    autoAnnounceOnScan: settings.autoAnnounceOnScan,
    chimeEnabled: settings.chimeEnabled,
    speechRate: settings.speechRate
  });
});

app.post('/api/settings', (req, res) => {
  const { pin, newPin, shopName, village, autoAnnounceOnScan, chimeEnabled, speechRate } = req.body;
  if (pin !== settings.adminPin) {
    return res.status(401).json({ success: false, message: 'Invalid Admin PIN' });
  }

  if (shopName) settings.shopName = shopName;
  if (village) settings.village = village;
  if (autoAnnounceOnScan !== undefined) settings.autoAnnounceOnScan = autoAnnounceOnScan;
  if (chimeEnabled !== undefined) settings.chimeEnabled = chimeEnabled;
  if (speechRate !== undefined) settings.speechRate = speechRate;
  if (newPin && newPin.trim()) settings.adminPin = newPin.trim();

  saveJson(SETTINGS_FILE, settings);
  io.emit('settings-updated', settings);
  res.json({ success: true, message: 'Settings updated successfully' });
});

// ==========================================
// CARD MANAGEMENT APIS
// ==========================================

// Search / Auto-suggest Cards
app.get('/api/cards', (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  const limit = parseInt(req.query.limit) || 1000;
  
  if (!query) {
    return res.json({ total: cards.length, cards: cards.slice(0, limit) });
  }
  
  const filtered = cards.filter(c => 
    (c.rationNo && c.rationNo.toLowerCase().includes(query)) ||
    (c.nameEn && c.nameEn.toLowerCase().includes(query)) ||
    (c.nameTe && c.nameTe.toLowerCase().includes(query)) ||
    (c.village && c.village.toLowerCase().includes(query)) ||
    (c.phone && c.phone.includes(query))
  );
  res.json({ total: filtered.length, cards: filtered.slice(0, limit) });
});

// Get Suggestions & Metadata (next available RC number, existing villages)
app.get('/api/cards/suggestions', (req, res) => {
  // Extract max numeric portion from RC-XXXX
  let maxNum = 0;
  cards.forEach(c => {
    const m = c.rationNo.match(/\d+/);
    if (m) {
      const n = parseInt(m[0], 10);
      if (n > maxNum) maxNum = n;
    }
  });

  const nextRationNo = 'RC-' + String(maxNum + 1).padStart(4, '0');
  const villages = [...new Set(cards.map(c => c.village).filter(Boolean))];

  res.json({
    nextRationNo,
    totalCards: cards.length,
    villages
  });
});

// Add or Update Single Card
app.post('/api/cards', async (req, res) => {
  const { rationNo, nameEn, nameTe, village, phone } = req.body;
  if (!rationNo || !nameEn) {
    return res.status(400).json({ success: false, message: 'Ration No and English Name are required' });
  }

  const cleanNo = rationNo.toString().trim().toUpperCase();
  const existingIdx = cards.findIndex(c => c.rationNo.toUpperCase() === cleanNo);
  const cardObj = {
    rationNo: cleanNo,
    nameEn: nameEn.toString().trim(),
    nameTe: (nameTe || '').toString().trim() || nameEn.toString().trim(),
    village: (village || '').toString().trim() || 'Main Village',
    phone: (phone || '').toString().trim()
  };

  if (existingIdx >= 0) {
    cards[existingIdx] = cardObj;
  } else {
    cards.push(cardObj);
  }

  saveJson(CARDS_FILE, cards);

  try {
    const qrDataUrl = await QRCode.toDataURL(cleanNo, { width: 300, margin: 2 });
    res.json({
      success: true,
      message: `Card ${cleanNo} saved & QR generated successfully`,
      card: { ...cardObj, qrDataUrl },
      total: cards.length
    });
  } catch (err) {
    res.json({ success: true, message: `Card ${cleanNo} saved successfully`, card: cardObj, total: cards.length });
  }
});

// Bulk Insert/Update Cards
app.post('/api/cards/bulk', (req, res) => {
  const rawList = req.body.cards;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid or empty cards list' });
  }

  let added = 0;
  let updated = 0;

  for (const item of rawList) {
    const rationNo = (item.rationNo || item.ration || item.rcNo || item['Ration No'] || item['Card No'] || '').toString().trim().toUpperCase();
    const nameEn = (item.nameEn || item.name || item.holderName || item['Name English'] || item['Name'] || '').toString().trim();
    const nameTe = (item.nameTe || item.telugu || item['Name Telugu'] || nameEn).toString().trim();
    const village = (item.village || item.area || item.colony || item['Village'] || 'Main Village').toString().trim();
    const phone = (item.phone || item.mobile || item['Phone'] || '').toString().trim();

    if (!rationNo || !nameEn) continue;

    const cardObj = { rationNo, nameEn, nameTe, village, phone };
    const existingIdx = cards.findIndex(c => c.rationNo === rationNo);
    if (existingIdx >= 0) {
      cards[existingIdx] = cardObj;
      updated++;
    } else {
      cards.push(cardObj);
      added++;
    }
  }

  saveJson(CARDS_FILE, cards);
  res.json({
    success: true,
    message: `Bulk imported ${added} new cards and updated ${updated} existing cards. Total database: ${cards.length} cards.`,
    total: cards.length,
    added,
    updated
  });
});

// Download Single QR Code PNG
app.get('/api/cards/:rationNo/qr.png', async (req, res) => {
  const rationNo = req.params.rationNo.toUpperCase();
  const holder = cards.find(c => c.rationNo === rationNo);

  try {
    const qrBuffer = await QRCode.toBuffer(rationNo, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    const safeName = holder ? holder.nameEn.replace(/[^a-zA-Z0-9]/g, '_') : 'Card';
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="QR_${rationNo}_${safeName}.png"`);
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).send('Error generating QR: ' + err.message);
  }
});

// Download All QR Codes as a single ZIP file
app.get('/api/cards/download-zip', async (req, res) => {
  try {
    const zip = new JSZip();
    const folder = zip.folder('Ration_QR_Codes');

    for (const card of cards) {
      const qrBuffer = await QRCode.toBuffer(card.rationNo, {
        width: 400,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });
      const safeName = card.nameEn.replace(/[^a-zA-Z0-9]/g, '_');
      folder.file(`${card.rationNo}_${safeName}.png`, qrBuffer);
    }

    const zipContent = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="All_Ration_QR_Codes.zip"');
    res.send(zipContent);
  } catch (err) {
    res.status(500).send('Failed to generate ZIP: ' + err.message);
  }
});

app.delete('/api/cards/:rationNo', (req, res) => {
  const rationNo = req.params.rationNo.toUpperCase();
  const idx = cards.findIndex(c => c.rationNo === rationNo);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Card not found' });
  }
  cards.splice(idx, 1);
  saveJson(CARDS_FILE, cards);
  res.json({ success: true, message: 'Card deleted successfully', total: cards.length });
});

// Excel Template Download
app.get('/api/cards/template', (req, res) => {
  const sampleData = [
    { 'Ration No': 'RC-0001', 'Name English': 'Ramesh Kumar', 'Name Telugu': 'రమేష్ కుమార్', 'Village': 'Main Village', 'Phone': '9876543210' },
    { 'Ration No': 'RC-0002', 'Name English': 'Suresh Kumar', 'Name Telugu': 'సురేష్ కుమార్', 'Village': 'SC Colony', 'Phone': '9876543211' },
    { 'Ration No': 'RC-0003', 'Name English': 'Lakshmi Devi', 'Name Telugu': 'లక్ష్మి దేవి', 'Village': 'Main Village', 'Phone': '9876543212' },
    { 'Ration No': 'RC-0004', 'Name English': 'Anitha Reddy', 'Name Telugu': 'అనిత రెడ్డి', 'Village': 'BC Colony', 'Phone': '9876543213' }
  ];

  const ws = xlsx.utils.json_to_sheet(sampleData);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'RationCards');

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="Ration_Card_Template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// Excel / CSV File Upload with deep column matching
app.post('/api/cards/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (!rawData || rawData.length === 0) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'The uploaded file is empty or could not be read' });
    }

    let added = 0;
    let updated = 0;

    for (const row of rawData) {
      const findVal = (patterns) => {
        for (const k of Object.keys(row)) {
          const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
          for (const p of patterns) {
            if (cleanK === p || cleanK.includes(p)) return row[k];
          }
        }
        return '';
      };

      const rationNo = (findVal(['rationno', 'rationnumber', 'cardno', 'rcno', 'ration', 'cardnumber', 'id', 'slno', 'no']) || '').toString().trim().toUpperCase();
      const nameEn = (findVal(['nameenglish', 'nameen', 'englishname', 'name', 'holdername', 'cardholder', 'personname', 'beneficiary']) || '').toString().trim();
      const nameTe = (findVal(['nametelugu', 'namete', 'teluguname', 'telugu', 'localname']) || nameEn).toString().trim();
      const village = (findVal(['village', 'area', 'colony', 'ward', 'address', 'loc', 'town']) || 'Main Village').toString().trim();
      const phone = (findVal(['phone', 'mobile', 'contact', 'cell']) || '').toString().trim();

      if (!rationNo || !nameEn) continue;

      const cardObj = { rationNo, nameEn, nameTe, village, phone };
      const idx = cards.findIndex(c => c.rationNo === rationNo);
      if (idx >= 0) {
        cards[idx] = cardObj;
        updated++;
      } else {
        cards.push(cardObj);
        added++;
      }
    }

    saveJson(CARDS_FILE, cards);
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: `Uploaded & Processed: ${added} added, ${updated} updated. Total cards now: ${cards.length}`,
      total: cards.length,
      added,
      updated
    });
  } catch (err) {
    console.error('Excel upload error:', err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: 'Failed to process Excel file: ' + err.message });
  }
});

// Printable QR Codes Batch Data
app.get('/api/cards/qr-data', async (req, res) => {
  try {
    const filter = (req.query.q || '').trim().toLowerCase();
    let list = cards;
    if (filter) {
      list = cards.filter(c => 
        c.rationNo.toLowerCase().includes(filter) ||
        c.nameEn.toLowerCase().includes(filter) ||
        c.nameTe.toLowerCase().includes(filter) ||
        c.village.toLowerCase().includes(filter)
      );
    }

    const cardsWithQr = await Promise.all(
      list.map(async (c) => {
        const qrDataUrl = await QRCode.toDataURL(c.rationNo, {
          width: 200,
          margin: 1,
          color: { dark: '#000000', light: '#ffffff' }
        });
        return { ...c, qrDataUrl };
      })
    );

    res.json({
      total: cardsWithQr.length,
      shopName: settings.shopName,
      village: settings.village,
      cards: cardsWithQr
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// QUEUE & TOKEN APIS
// ==========================================

function getQueueStateFormatted() {
  const waiting = queueState.queue.filter(q => q.status === 'WAITING');
  const serving = queueState.currentToken;
  const completed = queueState.queue.filter(q => q.status === 'COMPLETED');
  const skipped = queueState.queue.filter(q => q.status === 'SKIPPED');

  return {
    tokenNo: queueState.tokenNo,
    currentToken: queueState.currentToken,
    waiting,
    serving,
    completed,
    skipped,
    all: queueState.queue,
    totalIssued: queueState.tokenNo,
    waitingCount: waiting.length,
    completedCount: completed.length,
    skippedCount: skipped.length
  };
}

app.get('/api/queue/state', (req, res) => {
  res.json(getQueueStateFormatted());
});

// Scan or Manual Entry to issue token (Smart Matching by S.No 1-241, Last 4 digits, Full RC, Name, or Phone)
app.post('/api/scan', (req, res) => {
  const rawInput = (req.body.rationNo || req.body.query || '').toString().trim();
  if (!rawInput) {
    return res.status(400).json({ success: false, message: 'Please enter a card number, S.No, or name' });
  }

  const clean = rawInput.toUpperCase();
  const digitsOnly = rawInput.replace(/\D/g, '');

  // 1. Match by Serial Number (e.g. S.No 1 to 241)
  let holder = null;
  if (digitsOnly && digitsOnly.length <= 3) {
    const sNoNum = parseInt(digitsOnly, 10);
    holder = cards.find(c => c.sNo === sNoNum);
  }

  // 2. Exact Ration Number Match (e.g. 365370657769)
  if (!holder) {
    holder = cards.find(c => c.rationNo.toUpperCase() === clean);
  }

  // 3. Match by Last 4 Digits of Ration Card (e.g. 7769, 7818)
  if (!holder && digitsOnly) {
    holder = cards.find(c => c.rationNo.endsWith(digitsOnly) || (c.last4 && c.last4 === digitsOnly));
  }

  // 4. Name or Telugu Match
  if (!holder) {
    const queryLower = rawInput.toLowerCase();
    holder = cards.find(c => 
      c.nameEn.toLowerCase().includes(queryLower) || 
      (c.nameTe && c.nameTe.toLowerCase().includes(queryLower)) ||
      (c.phone && c.phone.includes(rawInput))
    );
  }

  if (!holder) {
    return res.status(404).json({
      success: false,
      message: `Card/S.No "${rawInput}" not found in database.`
    });
  }

  const rawRation = holder.rationNo;

  // Duplicate check
  const alreadyInQueue = queueState.queue.find(q => q.rationNo === rawRation);
  if (alreadyInQueue) {
    return res.json({
      success: false,
      isDuplicate: true,
      tokenNo: alreadyInQueue.tokenNo,
      status: alreadyInQueue.status,
      message: `[S.No #${holder.sNo || '--'}] ${holder.nameEn} (Ending ...${holder.last4 || rawRation.slice(-4)}) was already issued Token #${alreadyInQueue.tokenNo} [Status: ${alreadyInQueue.status}]`
    });
  }

  queueState.tokenNo += 1;
  const newEntry = {
    tokenNo: queueState.tokenNo,
    sNo: holder.sNo || null,
    rationNo: holder.rationNo,
    cardType: holder.cardType || 'FSC',
    last4: holder.last4 || holder.rationNo.slice(-4),
    nameEn: holder.nameEn,
    nameTe: holder.nameTe,
    village: holder.village,
    phone: holder.phone,
    issuedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
    servedAt: null,
    status: 'WAITING'
  };

  if (!queueState.currentToken) {
    newEntry.status = 'SERVING';
    newEntry.servedAt = newEntry.issuedAt;
    queueState.currentToken = newEntry;
    queueState.queue.push(newEntry);

    saveJson(QUEUE_FILE, queueState);
    io.emit('queue-updated', getQueueStateFormatted());
    io.emit('token-announced', newEntry);

    return res.json({
      success: true,
      autoCalled: true,
      ...newEntry,
      message: `Token #${newEntry.tokenNo} issued for [S.No #${holder.sNo}] ${holder.nameEn} (${holder.cardType} ...${newEntry.last4})`
    });
  }

  queueState.queue.push(newEntry);
  saveJson(QUEUE_FILE, queueState);
  io.emit('queue-updated', getQueueStateFormatted());

  res.json({
    success: true,
    autoCalled: false,
    ...newEntry,
    message: `Token #${newEntry.tokenNo} issued for [S.No #${holder.sNo}] ${holder.nameEn} (${holder.cardType} ...${newEntry.last4})`
  });
});

// Direct Phone Camera / Google Lens QR Scan Check-In (GET /scan/:rationNo)
app.get('/scan/:rationNo', (req, res) => {
  const rawRation = (req.params.rationNo || '').trim().toUpperCase();
  const holder = cards.find(c => c.rationNo === rawRation);

  if (!holder) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Card Not Found</title><link rel="stylesheet" href="/style.css"></head>
      <body style="padding: 2rem 1rem; text-align: center; font-family: sans-serif; background: #f8fafc;">
        <div style="max-width: 400px; margin: 0 auto; background: white; padding: 2rem; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
          <div style="font-size: 3rem;">❌</div>
          <h2 style="color: #b91c1c; margin: 0.5rem 0;">Card Not Found</h2>
          <p style="color: #64748b;">Ration Card <strong>${rawRation}</strong> is not registered in the system.</p>
          <a href="/counter" class="btn btn-primary" style="margin-top: 1rem; display: inline-block;">Go to Counter</a>
        </div>
      </body>
      </html>
    `);
  }

  // Check if already in queue
  let entry = queueState.queue.find(q => q.rationNo === rawRation);
  let isNew = false;

  if (!entry) {
    isNew = true;
    queueState.tokenNo += 1;
    entry = {
      tokenNo: queueState.tokenNo,
      rationNo: holder.rationNo,
      nameEn: holder.nameEn,
      nameTe: holder.nameTe,
      village: holder.village,
      phone: holder.phone,
      issuedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
      servedAt: null,
      status: 'WAITING'
    };

    if (!queueState.currentToken) {
      entry.status = 'SERVING';
      entry.servedAt = entry.issuedAt;
      queueState.currentToken = entry;
      io.emit('token-announced', entry);
    }

    queueState.queue.push(entry);
    saveJson(QUEUE_FILE, queueState);
    io.emit('queue-updated', getQueueStateFormatted());
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Token #${entry.tokenNo} - ${holder.nameEn}</title>
      <link rel="stylesheet" href="/style.css">
    </head>
    <body style="padding: 2rem 1rem; text-align: center; font-family: sans-serif; background: #0f172a; color: white;">
      <div style="max-width: 420px; margin: 0 auto; background: white; color: #1e293b; padding: 2rem; border-radius: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
        <div style="font-size: 0.85rem; font-weight: bold; color: #16a34a; text-transform: uppercase; letter-spacing: 1px;">
          ${isNew ? '🎉 Token Issued Successfully' : 'ℹ️ You Are in Queue'}
        </div>
        <div style="font-size: 4rem; font-weight: 900; color: #1e40af; margin: 0.5rem 0; line-height: 1;">#${entry.tokenNo}</div>
        <h2 style="margin: 0.25rem 0; font-size: 1.5rem;">${holder.nameEn}</h2>
        <h3 style="margin: 0.25rem 0; color: #0284c7; font-size: 1.25rem;">${holder.nameTe}</h3>
        <p style="color: #64748b; font-size: 0.9rem; margin-top: 0.5rem;">📍 ${holder.village} | 🪪 ${holder.rationNo}</p>
        
        <div style="margin-top: 1.5rem; padding: 0.75rem; background: #f1f5f9; border-radius: 12px; font-weight: 600;">
          Status: <span style="color: ${entry.status === 'SERVING' ? '#eab308' : '#16a34a'};">${entry.status}</span>
        </div>

        <div style="margin-top: 1.5rem; display: flex; gap: 0.5rem; justify-content: center;">
          <a href="/counter" class="btn btn-outline">Counter View</a>
          <a href="/display" class="btn btn-primary">Live Display ↗</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Counter: Call Next
app.post('/api/queue/call-next', (req, res) => {
  if (queueState.currentToken) {
    const currentInQueue = queueState.queue.find(q => q.tokenNo === queueState.currentToken.tokenNo);
    if (currentInQueue && currentInQueue.status === 'SERVING') {
      currentInQueue.status = 'COMPLETED';
      currentInQueue.completedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    }
  }

  const nextWaiting = queueState.queue.find(q => q.status === 'WAITING');
  if (!nextWaiting) {
    queueState.currentToken = null;
    saveJson(QUEUE_FILE, queueState);
    io.emit('queue-updated', getQueueStateFormatted());
    return res.json({ success: true, message: 'No more people waiting in queue', currentToken: null });
  }

  nextWaiting.status = 'SERVING';
  nextWaiting.servedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  queueState.currentToken = nextWaiting;

  saveJson(QUEUE_FILE, queueState);
  io.emit('queue-updated', getQueueStateFormatted());
  io.emit('token-announced', nextWaiting);

  res.json({ success: true, currentToken: nextWaiting });
});

// Counter: Call Specific Token
app.post('/api/queue/call-token', (req, res) => {
  const targetTokenNo = parseInt(req.body.tokenNo);
  const targetEntry = queueState.queue.find(q => q.tokenNo === targetTokenNo);

  if (!targetEntry) {
    return res.status(404).json({ success: false, message: `Token #${targetTokenNo} not found in today's queue` });
  }

  if (queueState.currentToken && queueState.currentToken.tokenNo !== targetTokenNo) {
    const cur = queueState.queue.find(q => q.tokenNo === queueState.currentToken.tokenNo);
    if (cur && cur.status === 'SERVING') {
      cur.status = 'COMPLETED';
      cur.completedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    }
  }

  targetEntry.status = 'SERVING';
  targetEntry.servedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  queueState.currentToken = targetEntry;

  saveJson(QUEUE_FILE, queueState);
  io.emit('queue-updated', getQueueStateFormatted());
  io.emit('token-announced', targetEntry);

  res.json({ success: true, currentToken: targetEntry });
});

// Counter: Repeat Current Announcement
app.post('/api/queue/repeat', (req, res) => {
  if (!queueState.currentToken) {
    return res.status(400).json({ success: false, message: 'No active token is currently serving' });
  }
  io.emit('token-announced', queueState.currentToken);
  res.json({ success: true, message: 'Announcement repeated', token: queueState.currentToken });
});

// Counter: Mark Current as Completed
app.post('/api/queue/complete', (req, res) => {
  if (!queueState.currentToken) {
    return res.status(400).json({ success: false, message: 'No active token to complete' });
  }

  const cur = queueState.queue.find(q => q.tokenNo === queueState.currentToken.tokenNo);
  if (cur) {
    cur.status = 'COMPLETED';
    cur.completedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  }

  const autoNext = req.body.callNext !== false;
  let nextServing = null;

  if (autoNext) {
    const nextWaiting = queueState.queue.find(q => q.status === 'WAITING');
    if (nextWaiting) {
      nextWaiting.status = 'SERVING';
      nextWaiting.servedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      queueState.currentToken = nextWaiting;
      nextServing = nextWaiting;
      io.emit('token-announced', nextWaiting);
    } else {
      queueState.currentToken = null;
    }
  } else {
    queueState.currentToken = null;
  }

  saveJson(QUEUE_FILE, queueState);
  io.emit('queue-updated', getQueueStateFormatted());

  res.json({ success: true, message: 'Marked as completed', nextToken: nextServing });
});

// Counter: Skip Current Token
app.post('/api/queue/skip', (req, res) => {
  if (!queueState.currentToken) {
    return res.status(400).json({ success: false, message: 'No active token to skip' });
  }

  const cur = queueState.queue.find(q => q.tokenNo === queueState.currentToken.tokenNo);
  if (cur) {
    cur.status = 'SKIPPED';
    cur.skippedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  }

  const autoNext = req.body.callNext !== false;
  let nextServing = null;

  if (autoNext) {
    const nextWaiting = queueState.queue.find(q => q.status === 'WAITING');
    if (nextWaiting) {
      nextWaiting.status = 'SERVING';
      nextWaiting.servedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      queueState.currentToken = nextWaiting;
      nextServing = nextWaiting;
      io.emit('token-announced', nextWaiting);
    } else {
      queueState.currentToken = null;
    }
  } else {
    queueState.currentToken = null;
  }

  saveJson(QUEUE_FILE, queueState);
  io.emit('queue-updated', getQueueStateFormatted());

  res.json({ success: true, message: 'Token skipped', nextToken: nextServing });
});

// Reset Day (PIN Protected)
app.post('/api/queue/reset', (req, res) => {
  const { pin } = req.body;
  if (pin !== settings.adminPin) {
    return res.status(401).json({ success: false, message: 'Invalid Admin PIN' });
  }

  if (queueState.queue.length > 0) {
    const archiveDate = new Date().toISOString().split('T')[0];
    queueState.history.push({
      date: archiveDate,
      totalIssued: queueState.tokenNo,
      records: queueState.queue
    });
  }

  queueState.tokenNo = 0;
  queueState.currentToken = null;
  queueState.queue = [];

  saveJson(QUEUE_FILE, queueState);
  io.emit('reset-done');
  io.emit('queue-updated', getQueueStateFormatted());

  res.json({ success: true, message: 'Queue successfully reset for the new day' });
});

// ==========================================
// MONTHLY TRACKING & PENDING REPORT APIS
// ==========================================

app.get('/api/reports/monthly-stats', (req, res) => {
  const issuedRations = new Set();
  
  // From active queue
  queueState.queue.forEach(q => {
    if (q.status === 'COMPLETED' || q.status === 'SERVING' || q.status === 'WAITING') {
      issuedRations.add(q.rationNo);
    }
  });

  // From archive history
  if (queueState.history) {
    queueState.history.forEach(h => {
      if (h.records) {
        h.records.forEach(r => {
          if (r.status === 'COMPLETED' || r.status === 'SERVING') {
            issuedRations.add(r.rationNo);
          }
        });
      }
    });
  }

  const issuedList = cards.filter(c => issuedRations.has(c.rationNo));
  const pendingList = cards.filter(c => !issuedRations.has(c.rationNo));
  const skippedList = queueState.queue.filter(q => q.status === 'SKIPPED');

  const fscTotal = cards.filter(c => (c.cardType || 'FSC') === 'FSC').length;
  const afscTotal = cards.filter(c => c.cardType === 'AFSC').length;

  const fscIssued = issuedList.filter(c => (c.cardType || 'FSC') === 'FSC').length;
  const afscIssued = issuedList.filter(c => c.cardType === 'AFSC').length;

  res.json({
    totalCards: cards.length,
    issuedCount: issuedList.length,
    pendingCount: pendingList.length,
    skippedCount: skippedList.length,
    fscTotal,
    afscTotal,
    fscIssued,
    afscIssued,
    issuedPercentage: cards.length > 0 ? ((issuedList.length / cards.length) * 100).toFixed(1) : 0,
    pendingPercentage: cards.length > 0 ? ((pendingList.length / cards.length) * 100).toFixed(1) : 0,
    skipped: skippedList,
    pending: pendingList.slice(0, 100) // Paginated preview
  });
});

// Download Pending Cardholders List (for Gram Panchayat / Ward follow-up)
app.get('/api/reports/pending-csv', (req, res) => {
  const issuedRations = new Set();
  queueState.queue.forEach(q => {
    if (q.status === 'COMPLETED' || q.status === 'SERVING' || q.status === 'WAITING') {
      issuedRations.add(q.rationNo);
    }
  });
  if (queueState.history) {
    queueState.history.forEach(h => {
      if (h.records) h.records.forEach(r => issuedRations.add(r.rationNo));
    });
  }

  const pendingList = cards.filter(c => !issuedRations.has(c.rationNo));
  let csv = 'S.No,Ration Card No,Card Type,Cardholder Name (English),Telugu Name,Village,Status\n';
  pendingList.forEach(p => {
    csv += `"${p.sNo || ''}","${p.rationNo}","${p.cardType || 'FSC'}","${p.nameEn}","${p.nameTe || ''}","${p.village || ''}","PENDING (NOT YET VISITED)"\n`;
  });

  const monthName = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }).replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Pending_Ration_Cards_${monthName}.csv"`);
  res.send('\uFEFF' + csv);
});

// Recall Skipped Beneficiary back to Waiting Queue
app.post('/api/queue/recall-skipped', (req, res) => {
  const tokenNo = parseInt(req.body.tokenNo);
  const entry = queueState.queue.find(q => q.tokenNo === tokenNo);
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Token not found in queue' });
  }

  entry.status = 'WAITING';
  entry.recalledAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  saveJson(QUEUE_FILE, queueState);
  io.emit('queue-updated', getQueueStateFormatted());

  res.json({ success: true, message: `Token #${tokenNo} (${entry.nameEn}) moved back to Waiting queue!` });
});

app.get('/api/reports/today-csv', (req, res) => {
  const todayDate = new Date().toISOString().split('T')[0];
  let csv = 'Token No,Ration No,Name (English),Name (Telugu),Village,Phone,Status,Issued Time,Served Time,Completed Time\n';

  queueState.queue.forEach(q => {
    csv += `"${q.tokenNo}","${q.rationNo}","${q.nameEn || ''}","${q.nameTe || ''}","${q.village || ''}","${q.phone || ''}","${q.status}","${q.issuedAt || ''}","${q.servedAt || ''}","${q.completedAt || q.skippedAt || ''}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Ration_Daily_Report_${todayDate}.csv"`);
  res.send('\uFEFF' + csv);
});

app.get('/api/reports/today-excel', (req, res) => {
  const todayDate = new Date().toISOString().split('T')[0];
  const reportData = queueState.queue.map(q => ({
    'Token No': q.tokenNo,
    'Ration No': q.rationNo,
    'Name (English)': q.nameEn,
    'Name (Telugu)': q.nameTe,
    'Village / Area': q.village,
    'Phone': q.phone,
    'Status': q.status,
    'Issued Time': q.issuedAt || '',
    'Served Time': q.servedAt || '',
    'Finished Time': q.completedAt || q.skippedAt || ''
  }));

  const ws = xlsx.utils.json_to_sheet(reportData.length > 0 ? reportData : [{ 'Message': 'No tokens issued today yet' }]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Daily_Report');

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="Ration_Report_${todayDate}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// HTML Page Routes
app.get('/counter', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'counter.html'));
});

app.get('/scanner', (req, res) => {
  res.redirect('/counter');
});

app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/print-qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'print-qr.html'));
});

// Socket.io Connection
io.on('connection', (socket) => {
  socket.emit('queue-updated', getQueueStateFormatted());
  socket.emit('settings-updated', settings);
});

const HTTP_PORT = process.env.PORT || 3000;
const HTTPS_PORT = 3443;

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log('==================================================');
  console.log(`🌾 SMART RATION QUEUE SYSTEM (HTTP) PORT ${HTTP_PORT}`);
  console.log(`   Local Machine:  http://localhost:${HTTP_PORT}`);
  ips.forEach(ip => {
    console.log(`   Local Wi-Fi:    http://${ip}:${HTTP_PORT}`);
  });
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    const ips = getLocalIpAddresses();
    console.log('--------------------------------------------------');
    console.log(`🔒 SECURE HTTPS SERVER (For Mobile Camera) PORT ${HTTPS_PORT}`);
    ips.forEach(ip => {
      console.log(`   📱 Mobile Camera: https://${ip}:${HTTPS_PORT}/counter`);
    });
    console.log('==================================================');
  });
}