const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const port = process.env.PORT || 3000;
const dataFile = path.join(__dirname, 'data.json');
const sessionDir = path.join(__dirname, 'whatsapp-session');

// Initialize WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'wa-check',
    dataPath: sessionDir,
  }),
  puppeteer: (function() {
    // Prefer running with a visible Chrome so QR injection/navigation issues are easier to debug.
    const defaultArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
    const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    try {
      // If Chrome exists at the path, use it with headless false so QR can be displayed.
      if (require('fs').existsSync(chromePath)) {
        return { headless: false, executablePath: chromePath, args: defaultArgs };
      }
    } catch (e) {
      console.warn('Could not verify Chrome path, falling back to headless mode:', e && e.message);
    }
    // Fallback to headless for environments without Chrome installed at the default path.
    return { headless: true, args: defaultArgs };
  })(),
});

let isClientReady = false;
let clientInitError = null;
let latestQRCode = null;

client.on('ready', () => {
  console.log('✓ WhatsApp Client SIAP!');
  isClientReady = true;
  clientInitError = null;
  latestQRCode = null;
});

client.on('auth_failure', (msg) => {
  console.error('✗ Autentikasi gagal:', msg);
  clientInitError = msg;
  isClientReady = false;
});

client.on('qr', (qr) => {
  console.log('QR terkirim, tunggu scan...');
  latestQRCode = qr;
});

client.on('disconnected', (reason) => {
  console.log('✗ WhatsApp terputus:', reason);
  isClientReady = false;
  clientInitError = reason;
});

client.on('error', (error) => {
  console.error('✗ WhatsApp error:', error.message);
  clientInitError = error.message;
});

// Initialize Client dengan timeout
console.log('Menginisialisasi WhatsApp Client...');
client.initialize().catch((err) => {
  console.error('Gagal init:', err.message);
  clientInitError = err.message;
});

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Error handler untuk JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'JSON tidak valid' });
  }
  next();
});

// Helper functions
function loadData() {
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { records: [], totals: { users: {}, countries: {} }, updatedAt: null };
  }
}

function saveData(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

function incrementCounter(container, key, field, value) {
  if (!container[key]) {
    container[key] = { numbers: 0, bioChecks: 0 };
  }
  container[key][field] += value;
}

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    ready: isClientReady,
    error: clientInitError,
    qrAvailable: Boolean(latestQRCode),
    message: isClientReady
      ? '✓ WhatsApp siap'
      : '✗ WhatsApp tidak siap: ' + (clientInitError || 'Loading...'),
  });
});

app.get('/api/qr', (req, res) => {
  res.json({
    ready: isClientReady,
    error: clientInitError,
    qr: latestQRCode,
  });
});

app.post('/api/check-numbers', async (req, res) => {
  console.log('=== REQUEST MASUK ===');
  
  try {
    const { numbers } = req.body;
    console.log('Numbers:', numbers);

    if (!isClientReady) {
      console.log('WhatsApp tidak ready');
      return res.status(400).json({
        success: false,
        error: 'WhatsApp tidak siap. Scan QR dari halaman web atau tunggu sampai siap.',
        results: [],
        checked: 0,
        registered: 0,
        notRegistered: 0,
      });
    }

    // Validasi input
    if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
      console.log('Input tidak valid');
      return res.json({ 
        success: false,
        error: 'Kirim array numbers',
        results: [],
        checked: 0,
        registered: 0,
        notRegistered: 0,
      });
    }

    console.log('Mulai cek', numbers.length, 'nomor...');
    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < numbers.length; i++) {
      const number = numbers[i];
      const cleaned = String(number).trim().replace(/[^+\d]/g, '');
      
      if (!cleaned) {
        failCount++;
        results.push({ input: number, registered: false, cleaned: '' });
        continue;
      }

      let registered = false;
      try {
        console.log(`[${i+1}/${numbers.length}] Cek: ${cleaned}`);
        const id = await client.getNumberId(cleaned);
        registered = id !== null;
        console.log(`  Result: ${registered ? 'FOUND' : 'NOT FOUND'}`);
      } catch (err) {
        console.log(`  Error: ${err.message}`);
        registered = false;
      }

      results.push({ input: number, cleaned, registered });
      if (registered) {
        successCount++;
      } else {
        failCount++;
      }
    }

    console.log('Selesai cek. Success:', successCount, 'Fail:', failCount);

    // Save data
    try {
      const data = loadData();
      data.records.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        results,
        successCount,
        failCount,
      });
      saveData(data);
      console.log('Data disimpan');
    } catch (err) {
      console.error('Gagal save data:', err.message);
    }

    const response = {
      success: true,
      checked: results.length,
      registered: successCount,
      notRegistered: failCount,
      results: results,
    };

    console.log('Mengirim response...');
    res.json(response);
    console.log('Response dikirim\n');

  } catch (error) {
    console.error('FATAL ERROR:', error.message);
    console.error(error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Error: ' + error.message,
      results: [],
      checked: 0,
      registered: 0,
      notRegistered: 0,
    });
  }
});

app.get('/api/stats', (req, res) => {
  const data = loadData();
  res.json({
    totals: data.totals,
    recordCount: data.records.length,
    updatedAt: data.updatedAt,
  });
});

// Serve HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`Backend berjalan di http://localhost:${port}`);
  console.log('Jika WhatsApp belum siap, jalankan: npm run check-whatsapp');
});
