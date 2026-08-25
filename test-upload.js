const xlsx = require('xlsx');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 1. Create a test Excel file
const testData = [
  { 'Ration No': 'RC-0101', 'Name English': 'Anil Kumar', 'Name Telugu': 'అనిల్ కుమార్', 'Village': 'East Colony', 'Phone': '9988776655' },
  { 'Ration No': 'RC-0102', 'Name English': 'Sunitha Devi', 'Name Telugu': 'సునీత దేవి', 'Village': 'West Colony', 'Phone': '9988776656' }
];

const ws = xlsx.utils.json_to_sheet(testData);
const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, ws, 'Cards');
const testFile = path.join(__dirname, 'test_cards.xlsx');
xlsx.writeFile(wb, testFile);

console.log('Test Excel file created at:', testFile);

// 2. Test multipart form upload using Node
const boundary = '----WebKitFormBoundary' + Math.random().toString(16);
const fileData = fs.readFileSync(testFile);

const postDataStart = Buffer.from(
  `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="file"; filename="test_cards.xlsx"\r\n` +
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
);
const postDataEnd = Buffer.from(`\r\n--${boundary}--\r\n`);
const fullBody = Buffer.concat([postDataStart, fileData, postDataEnd]);

const req = http.request('http://localhost:3000/api/cards/upload', {
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': fullBody.length
  }
}, (res) => {
  let respData = '';
  res.on('data', chunk => respData += chunk);
  res.on('end', () => {
    console.log('Upload response status:', res.statusCode);
    console.log('Upload response body:', respData);
  });
});

req.on('error', (e) => console.error('Upload error:', e));
req.write(fullBody);
req.end();