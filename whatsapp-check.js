const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

const sessionDir = path.join(__dirname, 'whatsapp-session');
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'wa-check',
    dataPath: sessionDir,
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

function parseNumbers(args) {
  return args
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/[^+\d]/g, ''))
    .filter(Boolean)
    .map((value) => {
      if (!value.startsWith('+')) {
        return `+${value}`;
      }
      return value;
    });
}

function saveSummary(summary) {
  const filePath = path.join(__dirname, 'whatsapp-check-results.json');
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2));
  console.log(`Hasil disimpan di ${filePath}`);
}

function showUsage() {
  console.log('Usage: node whatsapp-check.js +6281234567890 +6289876543210');
  console.log('Jika belum login, scan QR yang muncul di terminal.');
}

client.on('qr', (qr) => {
  console.log('Scan QR berikut untuk login ke WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('WhatsApp siap. Memeriksa nomor...');

  const numbers = parseNumbers(process.argv.slice(2));
  if (!numbers.length) {
    showUsage();
    process.exit(0);
    return;
  }

  const results = [];
  for (const number of numbers) {
    try {
      const id = await client.getNumberId(number);
      const registered = id !== null;
      results.push({
        input: number,
        registered,
        wa_id: registered ? id._serialized : null,
      });
    } catch (error) {
      results.push({
        input: number,
        registered: false,
        error: error.message,
      });
    }
  }

  console.table(results.map((item) => ({
    Nomor: item.input,
    Terdaftar: item.registered ? 'Ya' : 'Tidak',
    WA_ID: item.wa_id || '-',
    Error: item.error || '-',
  })));

  const summary = {
    checked: results.length,
    registered: results.filter((item) => item.registered).length,
    notRegistered: results.filter((item) => !item.registered).length,
    details: results,
  };

  saveSummary(summary);
  process.exit(0);
});

client.on('authenticated', () => {
  console.log('Berhasil terhubung ke WhatsApp.');
});

client.on('auth_failure', (msg) => {
  console.error('Autentikasi gagal:', msg);
});

client.on('disconnected', (reason) => {
  console.log('Terputus:', reason);
});

client.initialize();
