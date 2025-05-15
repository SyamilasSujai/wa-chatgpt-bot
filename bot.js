/**
 * WhatsApp ChatGPT Bot
 *
 * - Memindai QR code saat pertama kali dijalankan
 * - Mendengarkan pesan masuk (personal & grup)
 * - Meneruskan pesan ke OpenAI Chat Completion
 * - Mengirimkan balasan ChatGPT ke pengirim
 *
 * =============================================
 * ENVIRONMENT VARIABLES (.env)
 * =============================================
 *  OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxx
 *  OPENAI_MODEL=gpt-3.5-turbo      # opsional, default gpt-3.5-turbo
 *  PREFIX=!gpt                     # opsional, kosong berarti semua pesan
 * =============================================
 * Jalankan dengan:  node bot.js   (atau  npm start  bila disetel di package.json)
 */

require('dotenv').config();
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { OpenAI } = require('openai');
const { Boom } = require('@hapi/boom');

// ---------- Konfigurasi ----------
const PREFIX = process.env.PREFIX || ''; // setel menjadi "!gpt " agar hanya merespons pesan berawalan !gpt
const MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

// ---------- Inisialisasi OpenAI ----------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE,
});


async function startBot() {
  // 1️⃣  Autentikasi WhatsApp (Multi‑Device)
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
  });

  // Simpan kredensial setiap ada pembaruan
  sock.ev.on('creds.update', saveCreds);

  // 2️⃣  Event koneksi
  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : 0) !== DisconnectReason.loggedOut;

      console.log('❌ Terputus.', { shouldReconnect });
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Bot WhatsApp siap digunakan!');
    }
  });

  // 3️⃣  Event pesan masuk
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return; // hanya proses notifikasi pesan baru

    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return; // abaikan pesan sistem & pesan bot sendiri

    const sender = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      '';

    if (!text) return; // tidak ada teks yang bisa diproses

    // Jika menggunakan prefix, respon hanya bila pesan diawali prefix
    if (PREFIX && !text.trim().startsWith(PREFIX)) return;

    const prompt = PREFIX ? text.trim().slice(PREFIX.length).trim() : text.trim();
    if (!prompt) return;

    console.log(`📩 ${sender}: ${prompt}`);

    try {
      // 4️⃣  Kirim prompt ke OpenAI
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
      });

      const reply = completion.choices[0].message.content.trim();
      // 5️⃣  Kirim balasan ke pengirim (dikutip)
      await sock.sendMessage(sender, { text: reply }, { quoted: msg });
    } catch (err) {
      console.error('❌ Error OpenAI:', err);
      await sock.sendMessage(
        sender,
        { text: 'Maaf, terjadi kesalahan saat menghubungi ChatGPT. Coba lagi nanti.' },
        { quoted: msg },
      );
    }
  });
}

// Jalankan bot
startBot().catch((err) => console.error('FATAL:', err));

