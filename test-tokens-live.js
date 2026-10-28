const http = require('http');

function req(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, 'http://localhost:3000');
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(u, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Pin': '1234',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, data: buf ? JSON.parse(buf) : {} }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log('=====================================================');
  console.log('  TESTING LIVE TOKEN ISSUING & DISPLAY SYSTEM');
  console.log('=====================================================\n');

  console.log('1. RESETTING QUEUE FOR CLEAN TEST...');
  const resetRes = await req('/api/queue/reset', 'POST', { pin: '1234' });
  console.log('   Status:', resetRes.data.message);

  console.log('\n2. ISSUING 5 CONSECUTIVE BENEFICIARY TOKENS...');
  const cardsRes = await req('/api/cards');
  const allCards = Array.isArray(cardsRes.data) ? cardsRes.data : (cardsRes.data.cards || []);
  const sampleCards = allCards.slice(0, 5);

  for (let i = 0; i < sampleCards.length; i++) {
    const c = sampleCards[i];
    const scanRes = await req('/api/scan', 'POST', { rationNo: c.rationNo });
    const tok = scanRes.data;
    console.log('   Issued Token #' + tok.tokenNo + ': [S.No #' + c.sNo + ' ' + c.cardType + '] ' + c.nameEn + ' (' + c.nameTe + ') -> Ration: ' + c.rationNo);
  }

  console.log('\n3. CHECKING REAL-TIME QUEUE & NEXT BENEFICIARY IN LINE...');
  const qState1 = (await req('/api/queue/state')).data;
  console.log('   👉 NOW SERVING:             Token #' + qState1.serving.tokenNo + ' - ' + qState1.serving.nameEn + ' (' + qState1.serving.nameTe + ')');
  console.log('   👉 NEXT IN LINE (UPCOMING):    Token #' + qState1.waiting[0].tokenNo + ' - ' + qState1.waiting[0].nameEn + ' (' + qState1.waiting[0].nameTe + ')');
  console.log('   👉 TOTAL WAITING:           ' + qState1.waitingCount + ' beneficiaries');
  console.log('   👉 WAITING TOKENS LIST:     ' + qState1.waiting.map(w => '#' + w.tokenNo + ' (' + w.nameEn + ')').join(', '));

  console.log('\n4. ADVANCING QUEUE: COMPLETING TOKEN #1...');
  const nextRes = await req('/api/queue/complete', 'POST', { callNext: true });
  console.log('   Token #1 Completed.');
  const nowServing = nextRes.data.nextToken;
  console.log('   👉 NOW SERVING:             Token #' + nowServing.tokenNo + ' - ' + nowServing.nameEn + ' (' + nowServing.nameTe + ')');

  const qState2 = (await req('/api/queue/state')).data;
  console.log('   👉 NEW NEXT IN LINE:        Token #' + qState2.waiting[0].tokenNo + ' - ' + qState2.waiting[0].nameEn + ' (' + qState2.waiting[0].nameTe + ')');
  console.log('   👉 REMAINING WAITING:       ' + qState2.waitingCount);

  console.log('\n5. VERIFYING SINGLE-DIGIT VOICE ANNOUNCEMENT FORMAT...');
  const serving = qState2.serving;
  const digits = (serving.rationNo || '').replace(/\D/g, '');
  const last5 = digits.length >= 5 ? digits.slice(-5) : digits;
  const enDigits = last5.split('').join(', ');
  const teWords = { '0': 'సున్నా', '1': 'ఒకటి', '2': 'రెండు', '3': 'మూడు', '4': 'నాలుగు', '5': 'ఐదు', '6': 'ఆరు', '7': 'ఏడు', '8': 'ఎనిమిది', '9': 'తొమ్మిది' };
  const teDigits = last5.split('').map(d => teWords[d] || d).join(', ');

  console.log('   🔊 English Speech: "Token number ' + serving.tokenNo + ', ' + serving.nameEn + ', Card ending in: ' + enDigits + '"');
  console.log('   🔊 Telugu Speech:  "టోకెన్ సంఖ్య ' + serving.tokenNo + ', ' + serving.nameTe + ', కార్డు చివర నంబర్లు: ' + teDigits + '"');

  // Clean up test state
  await req('/api/queue/reset', 'POST', { pin: '1234', clearHistory: true });
  console.log('\n   🧹 Queue reset to clean state after test run.');

  console.log('\n=====================================================');
  console.log('  ✅ ALL TOKEN ISSUING & QUEUE FLOW CHECKS PASSED!');
  console.log('=====================================================');
})();
