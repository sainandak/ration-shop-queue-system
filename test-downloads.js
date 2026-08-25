const http = require('http');

function testDownloads() {
  // Test 1: Single QR PNG download
  http.get('http://localhost:3000/api/cards/RC-0001/qr.png', (res) => {
    console.log('✅ Single QR Download Status:', res.statusCode, 'Content-Type:', res.headers['content-type']);
  });

  // Test 2: Bulk ZIP download
  http.get('http://localhost:3000/api/cards/download-zip', (res) => {
    console.log('✅ Bulk ZIP Download Status:', res.statusCode, 'Content-Type:', res.headers['content-type']);
  });
}

testDownloads();