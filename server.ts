import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { telegramBotManager } from './src/server/telegramBotEngine';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Auto-connect saved Telegram bot token on server startup
  telegramBotManager.initFromSavedConfig();

  // 0. Health Check Endpoint (for Render / Koyeb / UptimeRobot 24/7 Keep-Alive)
  app.get('/api/health', (_req, res) => {
    const status = telegramBotManager.getStatus();
    res.json({
      ok: true,
      service: 'prepress-cloud-studio',
      botConnected: status.connected,
      botUsername: status.botInfo?.username || null,
      timestamp: new Date().toISOString(),
    });
  });

  // 1. Get Telegram Bot Live Status, Jobs, and Logs
  app.get('/api/telegram/status', (_req, res) => {
    res.json(telegramBotManager.getStatus());
  });

  // 2. Connect & Start Telegram Bot Long-Polling Engine
  app.post('/api/telegram/connect', async (req, res) => {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      res.status(400).json({ ok: false, error: 'يرجى إدخال توكن البوت (Bot Token)' });
      return;
    }
    const result = await telegramBotManager.connectBot(token);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ...result,
      status: telegramBotManager.getStatus(),
    });
  });

  // 3. Disconnect Telegram Bot
  app.post('/api/telegram/disconnect', async (_req, res) => {
    await telegramBotManager.disconnectBot();
    res.json({ ok: true, status: telegramBotManager.getStatus() });
  });

  // 4. Download Cached Telegram Job PDFs (proof, print, or source) from Web UI
  app.get('/api/telegram/download/:chatId/:fileType', (req, res) => {
    const { chatId, fileType } = req.params;
    const safeChatId = String(chatId).replace(/[^a-zA-Z0-9_-]/g, '');
    const cacheDir = '/tmp/prepress_cache';

    let filePath = path.join(cacheDir, `${safeChatId}.pdf`);
    let suffix = 'ORIGINAL.pdf';

    if (fileType === 'proof') {
      filePath = path.join(cacheDir, `${safeChatId}_proof.pdf`);
      suffix = 'CLIENT_PROOF.pdf';
    } else if (fileType === 'print') {
      filePath = path.join(cacheDir, `${safeChatId}_print.pdf`);
      suffix = 'PRINT_CMYK.pdf';
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'الملف غير موجود في الذاكرة المؤقتة' });
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Job_${safeChatId}_${suffix}"`);
    fs.createReadStream(filePath).pipe(res);
  });

  // 5. Re-trigger imposition for a cached Telegram job from the Web UI
  app.post('/api/telegram/impose-now', async (req, res) => {
    const { chatId, action } = req.body || {};
    if (!chatId) {
      res.status(400).json({ ok: false, error: 'chatId مطلوب' });
      return;
    }
    try {
      const result = await telegramBotManager.executeCachedImposition(
        chatId,
        action || 'card_486x330'
      );
      if (!result) {
        res.status(404).json({ ok: false, error: 'الملف غير موجود في الذاكرة المؤقتة' });
        return;
      }
      res.json({ ok: true, status: telegramBotManager.getStatus() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'خطأ أثناء المونتاج' });
    }
  });

  // Vite middleware for development / static serving for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Prepress Master Cloud Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
