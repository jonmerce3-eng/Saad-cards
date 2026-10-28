import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import {
  inspectUploadedPdf,
  generateImposedPdf,
} from '../utils/impositionEngine';

export interface BotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
}

export interface TelegramJobRecord {
  id: string;
  chatId: number | string;
  senderName: string;
  fileName: string;
  widthMm: number;
  heightMm: number;
  pageCount: number;
  isExact95x60: boolean;
  status: 'inspected' | 'awaiting_choice' | 'processing' | 'completed' | 'cancelled' | 'error';
  selectedMode?: string;
  sheetSize?: string;
  timestamp: string;
  errorMessage?: string;
  hasCachedFiles?: boolean;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

const CACHE_DIR = '/tmp/prepress_cache';
const CONFIG_FILE = path.resolve(process.cwd(), '.telegram-bot-config.json');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export function mapCallbackActionToOptions(action: string): {
  sheetType: '486x330' | '350x500';
  mode: 'cards_5x5' | 'center_sheet';
  sheetLabel: string;
} {
  if (action === 'card_350x500') {
    return {
      sheetType: '350x500',
      mode: 'cards_5x5',
      sheetLabel: '500×350 مم (25 كارت 5×5)',
    };
  }
  if (action === 'sheet_center') {
    return {
      sheetType: '486x330',
      mode: 'center_sheet',
      sheetLabel: '486×330 مم (توسيط في الفرخ)',
    };
  }
  return {
    sheetType: '486x330',
    mode: 'cards_5x5',
    sheetLabel: '486×330 مم (25 كارت 5×5)',
  };
}

class TelegramBotManager {
  private token: string = '';
  private botInfo: BotInfo | null = null;
  private isPolling: boolean = false;
  private pollOffset: number = 0;
  private pollAbortController: AbortController | null = null;
  private lastPollTime: string | null = null;
  private jobs: TelegramJobRecord[] = [];
  private logs: ActivityLogEntry[] = [];

  constructor() {
    // Do not auto-start polling on module import (prevents unit tests from hanging or competing with server)
  }

  public addLog(type: ActivityLogEntry['type'], message: string) {
    const entry: ActivityLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString('ar-EG'),
      type,
      message,
    };
    this.logs = [entry, ...this.logs.slice(0, 49)];
  }

  public initFromSavedConfig() {
    const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (envToken) {
      this.connectBot(envToken).catch(() => {});
      return;
    }
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        if (raw.token) {
          this.connectBot(raw.token).catch(() => {});
        }
      }
    } catch {
      // Ignore invalid config file
    }
  }

  private saveConfig(token: string, botInfo: BotInfo) {
    try {
      fs.writeFileSync(
        CONFIG_FILE,
        JSON.stringify({ token, botInfo, updatedAt: new Date().toISOString() }, null, 2),
        'utf-8'
      );
    } catch {
      // Ignore write error
    }
  }

  public getStatus() {
    return {
      connected: Boolean(this.token && this.botInfo),
      isPolling: this.isPolling,
      botInfo: this.botInfo,
      maskedToken: this.token
        ? `${this.token.slice(0, 6)}...${this.token.slice(-4)}`
        : null,
      lastPollTime: this.lastPollTime,
      jobs: this.jobs,
      logs: this.logs,
    };
  }

  public async connectBot(rawToken: string): Promise<{ ok: boolean; botInfo?: BotInfo; error?: string }> {
    const cleanToken = rawToken.trim();
    if (!cleanToken || !cleanToken.includes(':')) {
      return {
        ok: false,
        error: 'صيغة التوكن غير صحيحة. يجب أن يحتوي على أرقام متبوعة بنقطتين رأسيتين (:) مثل 123456:ABC-DEF',
      };
    }

    try {
      this.addLog('info', 'جاري التحقق من التوكن مع سيرفرات تليجرام...');
      const meRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
      const meData = (await meRes.json()) as { ok: boolean; result?: BotInfo; description?: string };

      if (!meData.ok || !meData.result) {
        this.addLog('error', `فشل التحقق من التوكن: ${meData.description || 'Invalid token'}`);
        return {
          ok: false,
          error: `التوكن غير صالح في تليجرام (${meData.description || 'Unauthorized'})`,
        };
      }

      // Stop existing polling loop if running
      this.stopPolling();

      // Remove any old n8n webhook so Telegram delivers updates to our cloud engine!
      // drop_pending_updates=false ensures any PDF the user just sent is processed immediately!
      await fetch(
        `https://api.telegram.org/bot${cleanToken}/deleteWebhook?drop_pending_updates=false`
      );

      this.token = cleanToken;
      this.botInfo = meData.result;
      this.saveConfig(cleanToken, meData.result);

      this.addLog(
        'success',
        `تم ربط البوت @${meData.result.username} (${meData.result.first_name}) وإلغاء أي Webhook قديم معلق بنجاح!`
      );

      this.startPolling();
      return { ok: true, botInfo: meData.result };
    } catch (err: any) {
      const msg = err?.message || 'خطأ في الاتصال بسيرفر تليجرام';
      this.addLog('error', `خطأ أثناء الاتصال بتليجرام: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  public async disconnectBot() {
    this.stopPolling();
    this.token = '';
    this.botInfo = null;
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
      }
    } catch {}
    this.addLog('warning', 'تم فصل البوت وإيقاف الاستماع التلقائي.');
  }

  public stopPolling() {
    this.isPolling = false;
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
  }

  private startPolling() {
    if (this.isPolling || !this.token) return;
    this.isPolling = true;
    this.addLog('info', 'بدأ محرك الاستماع الفوري لرسائل وملفات تليجرام (Long Polling Active)...');
    this.pollLoop();
  }

  private async pollLoop() {
    while (this.isPolling && this.token) {
      try {
        this.pollAbortController = new AbortController();
        const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.pollOffset}&timeout=15&allowed_updates=${encodeURIComponent(
          JSON.stringify(['message', 'callback_query'])
        )}`;

        const res = await fetch(url, {
          signal: this.pollAbortController.signal,
        });
        const data = (await res.json()) as {
          ok: boolean;
          result?: any[];
          error_code?: number;
          description?: string;
        };

        this.lastPollTime = new Date().toLocaleTimeString('ar-EG');

        if (!data.ok) {
          // If 409 Conflict (e.g., n8n re-registered a webhook), automatically deleteWebhook again
          if (data.error_code === 409) {
            this.addLog(
              'warning',
              'تم اكتشاف تداخل Webhook خارجي (مثل n8n)، جاري تحويل الاستقبال إلى الاستوديو السحابي تلقائياً...'
            );
            await fetch(
              `https://api.telegram.org/bot${this.token}/deleteWebhook?drop_pending_updates=false`
            );
          } else {
            this.addLog('error', `تنبيه من تليجرام: ${data.description || 'Unknown error'}`);
          }
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        if (Array.isArray(data.result) && data.result.length > 0) {
          for (const update of data.result) {
            this.pollOffset = update.update_id + 1;
            await this.handleUpdate(update);
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private async handleUpdate(update: any) {
    try {
      if (update.message) {
        await this.handleMessage(update.message);
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      }
    } catch (err: any) {
      this.addLog('error', `خطأ أثناء معالجة التحديث: ${err?.message || err}`);
    }
  }

  private async sendTelegramText(chatId: number | string, text: string, replyMarkup?: any) {
    if (!this.token) return;
    await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  }

  private async sendTelegramDocument(
    chatId: number | string,
    pdfBytes: Uint8Array,
    fileName: string,
    caption: string
  ) {
    if (!this.token) return;
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('caption', caption);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    formData.append('document', blob, fileName);

    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, {
      method: 'POST',
      body: formData,
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) {
      throw new Error(data.description || 'فشل إرسال الملف إلى تليجرام');
    }
  }

  private async handleMessage(msg: any) {
    const chatId = msg.chat?.id;
    const senderName =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') ||
      msg.from?.username ||
      `Chat ${chatId}`;

    if (msg.text) {
      const text = msg.text.trim();
      this.addLog('info', `رسالة نصية من ${senderName}: "${text}"`);

      if (text === '/start' || text.toLowerCase() === 'start') {
        await this.sendTelegramText(
          chatId,
          `👋 *أهلاً بك في نظام المونتاج والطباعة السحابي المتكامل!*\n\n📄 أرسل الآن أي ملف *PDF* كـ مستند (Document) هنا في المحادثة:\n• إذا كان المقاس *95×60 مم* (شامل البليد) سيتم عمل المونتاج (25 كارت 5×5) وإرسال ملف البروفة وملف الزنكات تلقائياً.\n• إذا كان مقاساً آخر، ستظهر لك أزرار تفاعلية لاختيار مقاس الفرخ أو التوسيط.`
        );
        return;
      }

      await this.sendTelegramText(
        chatId,
        `📥 النظام جاهز للاستقبال! أرسل ملف الـ *PDF* كمستند (File / Document) لبدء الفحص والمونتاج فوراً.`
      );
      return;
    }

    if (msg.photo) {
      this.addLog('warning', `${senderName} أرسل صورة مضغوطة بدلاً من ملف PDF`);
      await this.sendTelegramText(
        chatId,
        `⚠️ يرجى إرسال التصميم كـ *ملف PDF (Document)* وليس كصورة مضغوطة، للحفاظ على المقاس بالمليمتر ودقة الطباعة.`
      );
      return;
    }

    if (msg.document) {
      const doc = msg.document;
      const fileName: string = doc.file_name || 'Job.pdf';
      const fileId: string = doc.file_id;

      if (!fileName.toLowerCase().endsWith('.pdf') && doc.mime_type !== 'application/pdf') {
        this.addLog('warning', `${senderName} أرسل ملف غير PDF: ${fileName}`);
        await this.sendTelegramText(
          chatId,
          `⚠️ الملف المرسل (${fileName}) ليس بصيغة PDF. يرجى إرسال ملف PDF صالح.`
        );
        return;
      }

      this.addLog('info', `📥 استلام ملف PDF جديد من ${senderName}: ${fileName}`);

      // Download file from Telegram
      const fileInfoRes = await fetch(
        `https://api.telegram.org/bot${this.token}/getFile?file_id=${encodeURIComponent(fileId)}`
      );
      const fileInfoData = (await fileInfoRes.json()) as {
        ok: boolean;
        result?: { file_path: string };
        description?: string;
      };

      if (!fileInfoData.ok || !fileInfoData.result?.file_path) {
        throw new Error(fileInfoData.description || 'تعذر الحصول على مسار الملف من تليجرام');
      }

      const downloadUrl = `https://api.telegram.org/file/bot${this.token}/${fileInfoData.result.file_path}`;
      const pdfResponse = await fetch(downloadUrl);
      const arrayBuffer = await pdfResponse.arrayBuffer();
      const pdfBuffer = Buffer.from(arrayBuffer);

      // Save to /tmp/prepress_cache/<chatId>.pdf
      const cachedPdfPath = path.join(CACHE_DIR, `${chatId}.pdf`);
      const cachedMetaPath = path.join(CACHE_DIR, `${chatId}.json`);
      fs.writeFileSync(cachedPdfPath, pdfBuffer);

      // Inspect PDF
      const inspected = await inspectUploadedPdf(arrayBuffer, fileName);
      fs.writeFileSync(
        cachedMetaPath,
        JSON.stringify({
          chatId,
          senderName,
          fileName,
          widthMm: inspected.widthMm,
          heightMm: inspected.heightMm,
          pageCount: inspected.pageCount,
          isExact95x60: inspected.isExact95x60,
        }),
        'utf-8'
      );

      const jobId = `${chatId}-${Date.now()}`;
      const jobRecord: TelegramJobRecord = {
        id: jobId,
        chatId,
        senderName,
        fileName,
        widthMm: inspected.widthMm,
        heightMm: inspected.heightMm,
        pageCount: inspected.pageCount,
        isExact95x60: inspected.isExact95x60,
        status: inspected.isExact95x60 ? 'processing' : 'awaiting_choice',
        timestamp: new Date().toLocaleTimeString('ar-EG'),
        hasCachedFiles: false,
      };
      this.jobs = [jobRecord, ...this.jobs.filter((j) => j.chatId !== chatId).slice(0, 19)];

      if (inspected.isExact95x60) {
        this.addLog(
          'success',
          `⚡ مقاس قياسي (95×60 مم) للملف ${fileName} - بدء المونتاج التلقائي فوراً!`
        );
        await this.sendTelegramText(
          chatId,
          `⚡ *مقاس الكارت مضبوط تلقائياً (${inspected.widthMm}×${inspected.heightMm} مم شامل 2.5 مم بليد)!*\nجاري عمل المونتاج ورسم السينيوهات وتجهيز ملفات الطباعة والبروفة فوراً...`
        );
        await this.executeCachedImposition(chatId, 'card_486x330');
      } else {
        this.addLog(
          'info',
          `📐 مقاس الملف ${fileName} هو ${inspected.widthMm}×${inspected.heightMm} مم - تم إرسال أزرار الاختيار للعميل`
        );
        const reportMessage =
          `🔍 *تقرير فحص ملف الـ PDF:*\n` +
          `📄 الملف: \`${fileName}\`\n` +
          `📐 المقاس المقروء: *${inspected.widthMm} × ${inspected.heightMm} مم*\n` +
          `📑 عدد الصفحات: *${inspected.pageCount}*\n\n` +
          `👇 اختر نوع المونتاج المطلوب من الأزرار التالية:`;

        const inlineKeyboard = {
          inline_keyboard: [
            [
              {
                text: '✅ نعم - مونتاج كارت (48.6×33 سم)',
                callback_data: 'card_486x330',
              },
            ],
            [
              {
                text: '📐 مونتاج كارت (فرخ 50×35 سم)',
                callback_data: 'card_350x500',
              },
              {
                text: '📄 ليس كارت (وضع في منتصف الفرخ)',
                callback_data: 'sheet_center',
              },
            ],
            [
              {
                text: '❌ إلغاء العملية',
                callback_data: 'cancel_job',
              },
            ],
          ],
        };

        await this.sendTelegramText(chatId, reportMessage, inlineKeyboard);
      }
    }
  }

  private async handleCallbackQuery(cb: any) {
    const callbackId = cb.id;
    const data = cb.data;
    const chatId = cb.message?.chat?.id;

    // Acknowledge button click on Telegram
    if (this.token && callbackId) {
      await fetch(`https://api.telegram.org/bot${this.token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text: data === 'cancel_job' ? 'تم الإلغاء' : 'جاري تنفيذ المونتاج...',
        }),
      });
    }

    if (!chatId) return;

    if (data === 'cancel_job') {
      this.addLog('warning', `تم إلغاء عملية المونتاج للعميل (${chatId})`);
      this.jobs = this.jobs.map((j) =>
        j.chatId === chatId ? { ...j, status: 'cancelled' } : j
      );
      await this.sendTelegramText(chatId, '❌ تم إلغاء عملية المونتاج لهذا الملف بنجاح.');
      return;
    }

    this.addLog('info', `🔘 العميل اختار زر المونتاج: ${data}`);
    await this.sendTelegramText(
      chatId,
      '⏳ *جاري عمل المونتاج ورسم السينيوهات الخارجية وتجهيز ملفات البروفة والطباعة...*'
    );
    await this.executeCachedImposition(chatId, data);
  }

  public async executeCachedImposition(chatId: number | string, action: string) {
    const cachedPdfPath = path.join(CACHE_DIR, `${chatId}.pdf`);
    const cachedMetaPath = path.join(CACHE_DIR, `${chatId}.json`);

    if (!fs.existsSync(cachedPdfPath)) {
      await this.sendTelegramText(
        chatId,
        '⚠️ لم يتم العثور على الملف في الذاكرة المؤقتة. يرجى إعادة إرسال ملف الـ PDF.'
      );
      return null;
    }

    const pdfBytes = fs.readFileSync(cachedPdfPath);
    const meta = fs.existsSync(cachedMetaPath)
      ? JSON.parse(fs.readFileSync(cachedMetaPath, 'utf-8'))
      : { fileName: 'Job.pdf' };

    const baseName = (meta.fileName || 'Job.pdf').replace(/\.pdf$/i, '');
    const { sheetType, mode, sheetLabel } = mapCallbackActionToOptions(action);

    const sourceDoc = await PDFDocument.load(pdfBytes);

    const proofResult = await generateImposedPdf(sourceDoc, {
      sheetType,
      mode,
      viewType: 'proof',
    });

    const printResult = await generateImposedPdf(sourceDoc, {
      sheetType,
      mode,
      viewType: 'print',
    });

    // Save generated files in cache so web UI can also download them
    const proofCachePath = path.join(CACHE_DIR, `${chatId}_proof.pdf`);
    const printCachePath = path.join(CACHE_DIR, `${chatId}_print.pdf`);
    fs.writeFileSync(proofCachePath, Buffer.from(proofResult.pdfBytes));
    fs.writeFileSync(printCachePath, Buffer.from(printResult.pdfBytes));

    const proofFileName = `${baseName}_CLIENT_PROOF.pdf`;
    const printFileName = `${baseName}_PRINT_CMYK.pdf`;

    if (this.token) {
      // 11. Send Proof PDF
      await this.sendTelegramDocument(
        chatId,
        proofResult.pdfBytes,
        proofFileName,
        `👁‍🗨 ملف البروفة (مع السينيوهات الخارجية): ${baseName}\n📐 مقاس الفرخ: ${sheetLabel} | صافي القص: 90×55 مم | البليد: 2.5 مم`
      );

      // 12. Send Print-Ready CMYK PDF
      await this.sendTelegramDocument(
        chatId,
        printResult.pdfBytes,
        printFileName,
        `🖨 ملف الطباعة الجاهز للزنكات (CMYK + Registration Marks): ${baseName}`
      );
    }

    this.jobs = this.jobs.map((j) =>
      String(j.chatId) === String(chatId)
        ? {
            ...j,
            status: 'completed',
            selectedMode: action,
            sheetSize: sheetLabel,
            hasCachedFiles: true,
          }
        : j
    );

    this.addLog(
      'success',
      `✅ تم إرسال ملفي البروفة والطباعة (${baseName}) بنجاح عبر تليجرام!`
    );

    return {
      proofBytes: proofResult.pdfBytes,
      printBytes: printResult.pdfBytes,
      fileName: meta.fileName || 'Job.pdf',
      sheetSize: sheetLabel,
      pagesImposed: Math.min(sourceDoc.getPageCount(), 2),
    };
  }
}

export const telegramBotManager = new TelegramBotManager();
