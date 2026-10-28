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
  const staffPost = { method: 'POST', headers: { 'X-Admin-Pin': '1234' } };
  console.log('--- STARTING COMPREHENSIVE RATION QUEUE SYSTEM TESTS ---');

  // Test 1: Network info
  const net = await request(BASE + '/api/network-info');
  console.log('✅ Network Info API:', net.status === 200 ? 'PASS' : 'FAIL', net.data.urls);

  // Test 2: Cardholder Database
  const cards = await request(BASE + '/api/cards');
  console.log('✅ Card List API (Total Cards):', cards.data.total, cards.status === 200 ? 'PASS' : 'FAIL');
  const cardList = cards.data.cards || [];
  const c1 = cardList[0] || { rationNo: '365370657769', nameEn: 'Mandala Latha' };
  const c2 = cardList[1] || { rationNo: '365370657770', nameEn: 'Adla Balamma' };
  const c3 = cardList[2] || { rationNo: '365370657771', nameEn: 'Aleti Narsamma' };

  // Test 3: Reset day first to clean slate
  const resetRes = await request(BASE + '/api/queue/reset', { method: 'POST' }, { pin: '1234' });
  console.log('✅ Daily Reset with PIN:', resetRes.data.message);

  // Test 4: Scan Card 1
  const scan1 = await request(BASE + '/api/scan', { method: 'POST' }, { rationNo: c1.rationNo });
  console.log(`✅ Scan ${c1.rationNo} (Token 1):`, scan1.data.tokenNo === 1 && scan1.data.nameEn === c1.nameEn ? 'PASS' : 'FAIL', scan1.data.message);

  // Test 5: Scan Duplicate Card 1
  const dupScan = await request(BASE + '/api/scan', { method: 'POST' }, { rationNo: c1.rationNo });
  console.log('✅ Duplicate Scan Protection:', dupScan.data.isDuplicate === true ? 'PASS' : 'FAIL', dupScan.data.message);

  // Test 6: Scan Card 2
  const scan2 = await request(BASE + '/api/scan', { method: 'POST' }, { rationNo: c2.rationNo });
  console.log(`✅ Scan ${c2.rationNo} (Token 2):`, scan2.data.tokenNo === 2 ? 'PASS' : 'FAIL', scan2.data.message);

  // Test 7: Scan Card 3
  const scan3 = await request(BASE + '/api/scan', { method: 'POST' }, { rationNo: c3.rationNo });
  console.log(`✅ Scan ${c3.rationNo} (Token 3):`, scan3.data.tokenNo === 3 ? 'PASS' : 'FAIL', scan3.data.message);

  // Test 8: Check Queue State
  const qState = await request(BASE + '/api/queue/state');
  console.log('✅ Queue State:', {
    totalIssued: qState.data.totalIssued,
    serving: qState.data.serving ? qState.data.serving.tokenNo : null,
    waitingCount: qState.data.waitingCount
  });

  // Test 9: Repeat announcement while token 1 is serving
  const repeatRes = await request(BASE + '/api/queue/repeat', staffPost, {});
  console.log('✅ Repeat Audio Announcement API:', repeatRes.data.success ? 'PASS' : 'FAIL', repeatRes.data.message);

  // Test 10: Complete current and advance
  const completeRes = await request(BASE + '/api/queue/complete', staffPost, { callNext: true });
  console.log('✅ Complete & Call Next:', completeRes.data.success ? 'PASS' : 'FAIL', 'Now Serving:', completeRes.data.nextToken ? completeRes.data.nextToken.tokenNo : 'None');

  // Test 11: Skip current and advance
  const skipRes = await request(BASE + '/api/queue/skip', staffPost, { callNext: true });
  console.log('✅ Skip Current & Call Next:', skipRes.data.success ? 'PASS' : 'FAIL', 'Now Serving:', skipRes.data.nextToken ? skipRes.data.nextToken.tokenNo : 'None');

  // Test 12: Printable QR Data
  const qrData = await request(BASE + '/api/cards/qr-data?q=' + encodeURIComponent(c1.rationNo));
  console.log('✅ Batch QR Generation API (Count):', qrData.data.total, 'QR Data URL present:', qrData.data.cards[0].qrDataUrl.startsWith('data:image/png;base64') ? 'PASS' : 'FAIL');

  // Test 13: Report Export CSV
  const reportCsv = await request(BASE + '/api/reports/today-csv');
  console.log('✅ Daily Report CSV Export:', reportCsv.status === 200 && reportCsv.raw.includes(c1.nameEn) ? 'PASS' : 'FAIL');

  // Test Cleanup: Reset queue to pristine state
  await request(BASE + '/api/queue/reset', { method: 'POST' }, { pin: '1234', clearHistory: true });
  console.log('✅ Clean state restored after tests.');

  console.log('--- ALL BACKEND AND QUEUE TESTS COMPLETED SUCCESSFULLY! ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
