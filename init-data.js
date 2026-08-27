const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Sample initial cards
const initialCards = [
  { rationNo: 'RC-0001', nameEn: 'Ramesh Kumar', nameTe: 'రమేష్ కుమార్', village: 'Main Village', phone: '9876543210' },
  { rationNo: 'RC-0002', nameEn: 'Suresh Kumar', nameTe: 'సురేష్ కుమార్', village: 'SC Colony', phone: '9876543211' },
  { rationNo: 'RC-0003', nameEn: 'Lakshmi Devi', nameTe: 'లక్ష్మి దేవి', village: 'Main Village', phone: '9876543212' },
  { rationNo: 'RC-0004', nameEn: 'Anitha Reddy', nameTe: 'అనిత రెడ్డి', village: 'BC Colony', phone: '9876543213' },
  { rationNo: 'RC-0005', nameEn: 'Venkatesh Rao', nameTe: 'వెంకటేష్ రావు', village: 'North Street', phone: '9876543214' },
  { rationNo: 'RC-0006', nameEn: 'Parvathi Bai', nameTe: 'పార్వతి బాయి', village: 'Old Village', phone: '9876543215' },
  { rationNo: 'RC-0007', nameEn: 'Narasimha Murthy', nameTe: 'నరసింహ మూర్తి', village: 'Main Village', phone: '9876543216' },
  { rationNo: 'RC-0008', nameEn: 'Sita Raman', nameTe: 'సీత రామన్', village: 'Temple Street', phone: '9876543217' },
  { rationNo: 'RC-0009', nameEn: 'Govindappa', nameTe: 'గోవిందప్ప', village: 'SC Colony', phone: '9876543218' },
  { rationNo: 'RC-0010', nameEn: 'Kavitha Rani', nameTe: 'కవిత రాణి', village: 'BC Colony', phone: '9876543219' }
];

const cardsFile = path.join(dataDir, 'cards.json');
if (!fs.existsSync(cardsFile)) {
  fs.writeFileSync(cardsFile, JSON.stringify(initialCards, null, 2), 'utf8');
}

const initialQueue = {
  tokenNo: 0,
  currentToken: null,
  queue: [],
  history: []
};

const queueFile = path.join(dataDir, 'queue.json');
if (!fs.existsSync(queueFile)) {
  fs.writeFileSync(queueFile, JSON.stringify(initialQueue, null, 2), 'utf8');
}

const initialPin = process.env.ADMIN_PIN || crypto.randomInt(100000, 1000000).toString();
const pinSalt = crypto.randomBytes(16).toString('hex');
const initialSettings = {
  shopName: 'Sri Lakshmi Fair Price Shop (#042)',
  village: '',
  adminPinHash: `${pinSalt}:${crypto.scryptSync(initialPin, pinSalt, 64).toString('hex')}`,
  autoAnnounceOnScan: true,
  chimeEnabled: true,
  speechRate: 0.9,
  languages: ['en-IN', 'te-IN']
};

const settingsFile = path.join(dataDir, 'settings.json');
if (!fs.existsSync(settingsFile)) {
  fs.writeFileSync(settingsFile, JSON.stringify(initialSettings, null, 2), 'utf8');
  console.log(`Initial staff PIN: ${initialPin}`);
}

console.log('Initial data files created successfully!');
