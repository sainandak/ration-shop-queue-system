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
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function testFeatures() {
  const BASE = 'http://localhost:3000';

  // 1. Test Manual Add Single Card
  const manRes = await request(BASE + '/api/cards', { method: 'POST' }, {
    rationNo: 'RC-0501',
    nameEn: 'Vijay Varma',
    nameTe: 'విజయ్ వర్మ',
    village: 'New Colony',
    phone: '9848022338'
  });
  console.log('✅ Manual Add Single Card:', manRes.data.success ? 'PASS' : 'FAIL', manRes.data.message);

  // 2. Test Bulk Cards API
  const bulkRes = await request(BASE + '/api/cards/bulk', { method: 'POST' }, {
    cards: [
      { rationNo: 'RC-0502', nameEn: 'Srinivas Reddy', nameTe: 'శ్రీనివాస్ రెడ్డి', village: 'Main Village', phone: '9848022339' },
      { rationNo: 'RC-0503', nameEn: 'Geetha Kumari', nameTe: 'గీత కుమారి', village: 'BC Colony', phone: '9848022340' }
    ]
  });
  console.log('✅ Bulk Cards Import:', bulkRes.data.success ? 'PASS' : 'FAIL', bulkRes.data.message);

  // 3. Verify Cards Search
  const searchRes = await request(BASE + '/api/cards?q=Varma');
  console.log('✅ Search Manual Card ("Varma"):', searchRes.data.total === 1 ? 'PASS' : 'FAIL', searchRes.data.cards[0].nameEn);

  process.exit(0);
}

testFeatures().catch(e => {
  console.error(e);
  process.exit(1);
});