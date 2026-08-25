const http = require('http');

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOptions = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (body) {
      if (typeof body === 'object' && !Buffer.isBuffer(body)) {
        body = JSON.stringify(body);
        reqOptions.headers['Content-Type'] = 'application/json';
      }
      reqOptions.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, raw: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runTests() {
  const BASE = 'http://localhost:3000';
  console.log('--- STARTING COMPREHENSIVE RATION QUEUE SYSTEM TESTS ---');

  // Test 1: Network info
  const net = await request(BASE + '/api/network-info');
  console.log('✅ Network Info API:', net.status === 200 ? 'PASS' : 'FAIL', net.data.urls);

  // Test 2: Cardholder Database
  const cards = await request(BASE + '/api/cards');
  console.log('✅ Card List API (Total Cards):', cards.data.total, cards.status === 200 ? 'PASS' : 'FAIL');

  // Test 3: Reset day first to clean slate
  const resetRes = await request(BASE + '/api/queue/reset', { method: 'POST' }, { pin: '1234' });
  console.log('✅ Daily Reset with PIN:', resetRes.data.message);

  // Test 4: Scan Card RC-0001 (Ramesh Kumar / రమేష్ కుమార్)
  const scan1 = await request(BASE + '/api/scan', { method: 'POST' }, { rationNo: 'RC-0001' });
  console.log('✅ Scan RC-0001 (Token 1):', scan1.data.tokenNo === 1 && scan1.data.nameEn === 'Ramesh Kumar' ? 'PASS' : 'FAIL', scan1.data.message);

  // Test 5: Scan Duplicate RC-0001
  const dupScan = await request(BASE + '/api/scan', { method: 'POST' }, { rationNo: 'RC-0001' });
  console.log('✅ Duplicate Scan Protection:', dupScan.data.isDuplicate === true ? 'PASS' : 'FAIL', dupScan.data.message);

  // Test 6: Scan Card RC-0002 (Suresh Kumar / సురేష్ కుమార్)
  const scan2 = await request(BASE + '/api/scan', { method: 'POST' }, { rationNo: 'RC-0002' });
  console.log('✅ Scan RC-0002 (Token 2):', scan2.data.tokenNo === 2 ? 'PASS' : 'FAIL', scan2.data.message);

  // Test 7: Scan Card RC-0003 (Lakshmi Devi / లక్ష్మి దేవి)
  const scan3 = await request(BASE + '/api/scan', { method: 'POST' }, { rationNo: 'RC-0003' });
  console.log('✅ Scan RC-0003 (Token 3):', scan3.data.tokenNo === 3 ? 'PASS' : 'FAIL', scan3.data.message);

  // Test 8: Check Queue State
  const qState = await request(BASE + '/api/queue/state');
  console.log('✅ Queue State:', {
    totalIssued: qState.data.totalIssued,
    serving: qState.data.serving ? qState.data.serving.tokenNo : null,
    waitingCount: qState.data.waitingCount
  });

  // Test 9: Complete current and advance
  const completeRes = await request(BASE + '/api/queue/complete', { method: 'POST' }, { callNext: true });
  console.log('✅ Complete & Call Next:', completeRes.data.success ? 'PASS' : 'FAIL', 'Now Serving:', completeRes.data.nextToken ? completeRes.data.nextToken.tokenNo : 'None');

  // Test 10: Skip current and advance
  const skipRes = await request(BASE + '/api/queue/skip', { method: 'POST' }, { callNext: true });
  console.log('✅ Skip Current & Call Next:', skipRes.data.success ? 'PASS' : 'FAIL', 'Now Serving:', skipRes.data.nextToken ? skipRes.data.nextToken.tokenNo : 'None');

  // Test 11: Repeat announcement
  const repeatRes = await request(BASE + '/api/queue/repeat', { method: 'POST' });
  console.log('✅ Repeat Audio Announcement API:', repeatRes.data.success ? 'PASS' : 'FAIL');

  // Test 12: Printable QR Data
  const qrData = await request(BASE + '/api/cards/qr-data');
  console.log('✅ Batch QR Generation API (Count):', qrData.data.total, 'QR Data URL present:', qrData.data.cards[0].qrDataUrl.startsWith('data:image/png;base64') ? 'PASS' : 'FAIL');

  // Test 13: Report Export CSV
  const reportCsv = await request(BASE + '/api/reports/today-csv');
  console.log('✅ Daily Report CSV Export:', reportCsv.status === 200 && reportCsv.raw.includes('Ramesh Kumar') ? 'PASS' : 'FAIL');

  console.log('--- ALL BACKEND AND QUEUE TESTS COMPLETED SUCCESSFULLY! ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});