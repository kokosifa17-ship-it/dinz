const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const port = process.env.PORT || 3000;
const dataFile = path.join(__dirname, 'data.json');
// Allow overriding the session directory via env (useful for Render persistent disk)
const sessionDir = process.env.SESSION_DIR || path.join(__dirname, 'whatsapp-session');
const browserDir = process.env.BROWSER_DIR || path.join(sessionDir, 'browser-profile');

if (!fs.existsSync(browserDir)) {
  fs.mkdirSync(browserDir, { recursive: true });
}

// Initialize WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'wa-check',
    dataPath: sessionDir,
  }),
  // Puppeteer options configurable via environment variables:
  // - PUPPETEER_EXECUTABLE_PATH or CHROME_PATH: path to installed Chrome/Chromium
  // - PUPPETEER_HEADLESS: 'true' or 'false'
  puppeteer: (function() {
    const defaultArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--single-process',
      '--disable-gpu'
    ];

    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
    const headlessEnv = process.env.PUPPETEER_HEADLESS;
    const headless = typeof headlessEnv === 'string' ? headlessEnv.toLowerCase() === 'true' : false;

    const opts = { headless, args: defaultArgs };
    if (execPath) {
      opts.executablePath = execPath;
    }
    return opts;
  })(),
});

let isClientReady = false;
let clientInitError = null;
let latestQRCode = null;
let pairCodes = {};
let isPaired = false;
let latestPairingData = null;

client.on('ready', () => {
  console.log('✓ WhatsApp Client SIAP!');
  isClientReady = true;
  clientInitError = null;
  latestQRCode = null;
  latestPairingData = null;
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

client.on('pairing_code', (code, details) => {
  console.log('Pairing code available:', code);
  latestPairingData = { code: String(code), details: details || null };
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

function initializeWhatsAppClient() {
  console.log('Menginisialisasi WhatsApp Client...');
  client.initialize().catch((err) => {
    console.error('Gagal init:', err.message);
    clientInitError = err.message;

    const conflictMessage = String(err.message).toLowerCase();
    if (conflictMessage.includes('another browser process') || conflictMessage.includes('already running')) {
      console.warn('Deteksi konflik browser lama. Menghapus direktori browser profil yang mungkin rusak...');
      try {
        fs.rmSync(browserDir, { recursive: true, force: true });
        fs.mkdirSync(browserDir, { recursive: true });
        console.log('Direktori browser profil dibersihkan. Mencoba inisialisasi ulang...');
        client.initialize().catch((retryErr) => {
          console.error('Retry gagal:', retryErr.message);
          clientInitError = retryErr.message;
        });
      } catch (cleanupErr) {
        console.error('Gagal membersihkan direktori browser profil:', cleanupErr.message);
      }
    }
  });
}

initializeWhatsAppClient();

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    pairingAvailable: Boolean(latestPairingData),
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
    paired: isPaired,
    pairing: latestPairingData,
  });
});
// Force initialize WhatsApp client
app.post('/api/initialize', (req, res) => {
  if (isClientReady) {
    return res.json({
      status: 'ready',
      message: 'WhatsApp sudah siap.',
    });
  }

  if (!isClientReady) {
    initializeWhatsAppClient();
    return res.json({
      status: 'initializing',
      message: 'WhatsApp client sedang diinisialisasi ulang. Tunggu beberapa saat...',
    });
  }

  res.json({
    status: 'error',
    message: clientInitError || 'Error tidak diketahui',
  });
});

// Pairing code endpoints
app.get('/api/pair', (req, res) => {
  // generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes
  pairCodes[code] = { expires };
  latestPairingData = { code: String(code), expires };
  console.log('Pair code generated:', code, 'expires at', new Date(expires).toISOString());
  res.json({ code, expiresAt: new Date(expires).toISOString() });
});

app.post('/api/pair/confirm', (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ success: false, error: 'Missing code' });
  const entry = pairCodes[code];
  if (!entry) return res.status(404).json({ success: false, error: 'Code not found' });
  if (Date.now() > entry.expires) {
    delete pairCodes[code];
    latestPairingData = null;
    return res.status(410).json({ success: false, error: 'Code expired' });
  }
  isPaired = true;
  delete pairCodes[code];
  latestPairingData = null;
  console.log('Pair confirmed for code', code);
  res.json({ success: true, paired: true });
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

    if (numbers.length > 200) {
      console.log('Input lebih dari 200 nomor');
      return res.status(400).json({
        success: false,
        error: 'Maksimal 200 nomor per request.',
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
      } else {
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

      if ((i + 1) % 5 === 0 && i + 1 < numbers.length) {
        console.log('Menunggu 2 detik sebelum melanjutkan...');
        await delay(2000);
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
