import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Printer, 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  Download, 
  Eye, 
  Layers, 
  Sparkles, 
  Send, 
  Maximize2, 
  RefreshCw,
  HelpCircle,
  Sliders,
  Radio,
  Power,
  Activity,
  ExternalLink
} from 'lucide-react';
import { SHEET_CONFIGS } from './utils/prepress';
import { 
  inspectUploadedPdf, 
  generateImposedPdf, 
  createSampleBusinessCardPdf, 
  PdfInspectionResult
} from './utils/impositionEngine';

interface ProcessedJob {
  id: string;
  fileName: string;
  timestamp: string;
  sheetType: '486x330' | '350x500';
  dimensionsMm: string;
  pageCount: number;
  status: string;
}

interface BotInfo {
  id: number;
  first_name: string;
  username: string;
}

interface TelegramJobRecord {
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
  hasCachedFiles?: boolean;
}

interface ActivityLogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface TelegramServerStatus {
  connected: boolean;
  isPolling: boolean;
  botInfo: BotInfo | null;
  maskedToken: string | null;
  lastPollTime: string | null;
  jobs: TelegramJobRecord[];
  logs: ActivityLogEntry[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'telegram' | 'studio' | 'guide'>('telegram');
  const [inspection, setInspection] = useState<PdfInspectionResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<'486x330' | '350x500'>('486x330');
  const [impositionMode, setImpositionMode] = useState<'cards_5x5' | 'center_sheet'>('cards_5x5');
  const [viewMode, setViewMode] = useState<'proof' | 'print'>('proof');
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [jobHistory, setJobHistory] = useState<ProcessedJob[]>([]);

  // Real Backend Telegram Bot State
  const [botTokenInput, setBotTokenInput] = useState<string>('');
  const [isConnectingBot, setIsConnectingBot] = useState<boolean>(false);
  const [telegramStatus, setTelegramStatus] = useState<TelegramServerStatus>({
    connected: false,
    isPolling: false,
    botInfo: null,
    maskedToken: null,
    lastPollTime: null,
    jobs: [],
    logs: [],
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchTelegramStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/status');
      if (res.ok) {
        const data = (await res.json()) as TelegramServerStatus;
        setTelegramStatus(data);
      }
    } catch {
      // Ignore transient network errors
    }
  }, []);

  useEffect(() => {
    loadSamplePdf();
    fetchTelegramStatus();
    const interval = setInterval(fetchTelegramStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchTelegramStatus]);

  const handleConnectBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botTokenInput.trim()) {
      setStatusMessage({
        type: 'error',
        text: 'يرجى لصق توكن البوت (Bot Token) الذي حصلت عليه من @BotFather أولاً.',
      });
      return;
    }

    try {
      setIsConnectingBot(true);
      setStatusMessage({
        type: 'info',
        text: 'جاري الاتصال بسيرفرات تليجرام وإلغاء أي Webhook قديم معلق وتفعيل الاستقبال الفوري...',
      });

      const res = await fetch('/api/telegram/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: botTokenInput.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatusMessage({
          type: 'error',
          text: data.error || 'تعذر ربط البوت، تأكد من صحة التوكن.',
        });
        return;
      }

      if (data.status) {
        setTelegramStatus(data.status);
      } else {
        await fetchTelegramStatus();
      }
      setBotTokenInput('');
      setStatusMessage({
        type: 'success',
        text: `تم ربط وتشغيل البوت @${data.botInfo?.username} بنجاح! أرسل الآن أي ملف PDF للبوت في تليجرام وسيصلك الرد فوراً.`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'حدث خطأ أثناء الاتصال بالسيرفر.',
      });
    } finally {
      setIsConnectingBot(false);
    }
  };

  const handleDisconnectBot = async () => {
    try {
      const res = await fetch('/api/telegram/disconnect', { method: 'POST' });
      const data = await res.json();
      if (data.status) {
        setTelegramStatus(data.status);
      }
      setStatusMessage({
        type: 'info',
        text: 'تم فصل البوت وإيقاف الاستماع التلقائي.',
      });
    } catch {
      // Ignore
    }
  };

  const handleTriggerTelegramJobImposition = async (chatId: number | string, action: string) => {
    try {
      setStatusMessage({
        type: 'info',
        text: 'جاري تنفيذ المونتاج وإرسال ملفي البروفة والطباعة إلى تليجرام...',
      });
      const res = await fetch('/api/telegram/impose-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, action }),
      });
      const data = await res.json();
      if (data.ok && data.status) {
        setTelegramStatus(data.status);
        setStatusMessage({
          type: 'success',
          text: 'تم عمل المونتاج وإرسال ملفي CLIENT_PROOF و PRINT_CMYK إلى المحادثة في تليجرام بنجاح!',
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: data.error || 'تعذر تنفيذ المونتاج لهذا الملف.',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'خطأ أثناء تنفيذ المونتاج.',
      });
    }
  };

  const loadSamplePdf = async () => {
    try {
      setIsProcessing(true);
      const sampleBytes = await createSampleBusinessCardPdf();
      const result = await inspectUploadedPdf(sampleBytes.buffer, 'Business_Card_Demo.pdf');
      setInspection(result);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setStatusMessage({ type: 'error', text: 'يرجى اختيار ملف بصيغة PDF فقط.' });
      return;
    }
    try {
      setIsProcessing(true);
      setStatusMessage({ type: 'info', text: 'جاري قراءة الملف وفحص الأبعاد...' });
      const result = await inspectUploadedPdf(file, file.name);
      setInspection(result);
      setActivePageIndex(0);

      if (result.isExact95x60) {
        setImpositionMode('cards_5x5');
        setStatusMessage({
          type: 'success',
          text: '⚡ مقاس قياسي مضبوط (95×60 مم) - تم تفعيل مونتاج 25 كارت تلقائياً',
        });
      } else {
        setStatusMessage({
          type: 'info',
          text: `المقاس: ${result.widthMm} × ${result.heightMm} مم - يمكنك اختيار نوع المونتاج أو التحميل مباشرة`,
        });
      }

      const newJob: ProcessedJob = {
        id: Date.now().toString(),
        fileName: file.name,
        timestamp: new Date().toLocaleTimeString('ar-EG'),
        sheetType: selectedSheet,
        dimensionsMm: `${result.widthMm} × ${result.heightMm} مم`,
        pageCount: result.pageCount,
        status: result.isExact95x60 ? '95×60 قياسي' : 'مقاس خاص',
      };
      setJobHistory(prev => [newJob, ...prev.slice(0, 9)]);
    } catch (err) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'حدث خطأ أثناء قراءة ملف الـ PDF' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const triggerDownload = (bytes: Uint8Array, filename: string) => {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = async (type: 'proof' | 'print' | 'both') => {
    if (!inspection) return;
    try {
      setIsProcessing(true);
      setStatusMessage({ type: 'info', text: 'جاري توليد ملفات الـ PDF عالية الدقة...' });

      if (type === 'proof' || type === 'both') {
        const proof = await generateImposedPdf(inspection.rawPdfDoc, {
          sheetType: selectedSheet,
          mode: impositionMode,
          viewType: 'proof',
        });
        triggerDownload(proof.pdfBytes, `${inspection.fileName.replace(/\.pdf$/i, '')}_CLIENT_PROOF.pdf`);
      }

      if (type === 'print' || type === 'both') {
        const print = await generateImposedPdf(inspection.rawPdfDoc, {
          sheetType: selectedSheet,
          mode: impositionMode,
          viewType: 'print',
        });
        triggerDownload(print.pdfBytes, `${inspection.fileName.replace(/\.pdf$/i, '')}_PRINT_CMYK.pdf`);
      }

      setStatusMessage({ type: 'success', text: 'تم تجهيز وتحميل الملفات بنجاح!' });
    } catch (err) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'حدث خطأ أثناء توليد ملف المونتاج' });
    } finally {
      setIsProcessing(false);
    }
  };

  const currentSheetConfig = SHEET_CONFIGS[selectedSheet];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black" dir="rtl">
      
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 font-bold shadow-lg shadow-cyan-950">
            <Printer className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold text-white tracking-tight">
                Prepress Cloud Studio
              </h1>
              {telegramStatus.connected ? (
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  بوت تليجرام متصل: @{telegramStatus.botInfo?.username}
                </span>
              ) : (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  بانتظار ربط توكن البوت
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              محرك مونتاج سحابي متكامل • يستقبل من تليجرام ومن المتصفح مباشرة بدون ماك أو Pinggy
            </p>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('telegram')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition ${
              activeTab === 'telegram'
                ? 'bg-cyan-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Send className="w-4 h-4" />
            تشغيل وربط بوت تليجرام
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('studio')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition ${
              activeTab === 'studio'
                ? 'bg-cyan-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" />
            استوديو المونتاج المباشر
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('guide')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition ${
              activeTab === 'guide'
                ? 'bg-cyan-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            مقارنة النظام والدليل
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">

        {/* Global Notification Banner */}
        {statusMessage && (
          <div
            role="status"
            className={`p-4 rounded-xl border text-xs flex items-center justify-between gap-3 ${
              statusMessage.type === 'error'
                ? 'bg-rose-950/40 border-rose-800/60 text-rose-200'
                : statusMessage.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
                : 'bg-cyan-950/40 border-cyan-800/60 text-cyan-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {statusMessage.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span className="font-medium leading-relaxed">{statusMessage.text}</span>
            </div>
            <button
              type="button"
              aria-label="إغلاق التنبيه"
              onClick={() => setStatusMessage(null)}
              className="text-slate-400 hover:text-white text-xs px-2 py-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* TAB 1: REAL CLOUD TELEGRAM BOT ENGINE */}
        {activeTab === 'telegram' && (
          <div className="space-y-6">
            {/* Connection & Status Card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                    <Send className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-bold text-white text-base">
                      محرك بوت تليجرام السحابي المباشر (بدون n8n وبدون ماك)
                    </h2>
                    <p className="text-xs text-slate-400">
                      ضع التوكن هنا مرة واحدة: سيقوم السيرفر بإلغاء أي Webhook قديم معلق، ويستقبل ملفات الـ PDF ويرد بالأزرار التفاعلية وملفات البروفة والطباعة فوراً!
                    </p>
                  </div>
                </div>

                {telegramStatus.connected && telegramStatus.botInfo && (
                  <div className="flex items-center gap-3">
                    <a
                      href={`https://t.me/${telegramStatus.botInfo.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-bold flex items-center gap-1.5 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      فتح البوت @{telegramStatus.botInfo.username}
                    </a>
                    <button
                      type="button"
                      onClick={handleDisconnectBot}
                      className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
                    >
                      <Power className="w-3.5 h-3.5" />
                      إيقاف وفصل البوت
                    </button>
                  </div>
                )}
              </div>

              {/* Active Bot Status Box OR Connect Form */}
              {telegramStatus.connected && telegramStatus.botInfo ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-800/40 space-y-1">
                    <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 animate-pulse" />
                      حالة الاتصال والاستماع
                    </span>
                    <p className="text-sm font-bold text-white">
                      متصل وشغال تلقائياً (Long Polling)
                    </p>
                    <p className="text-[11px] text-slate-400">
                      آخر فحص: {telegramStatus.lastPollTime || 'الآن'}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                    <span className="text-[11px] text-slate-400">اسم ومعرف البوت</span>
                    <p className="text-sm font-bold text-cyan-300 font-mono">
                      @{telegramStatus.botInfo.username}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      الاسم: {telegramStatus.botInfo.first_name} ({telegramStatus.maskedToken})
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                    <span className="text-[11px] text-slate-400">كيف تجرب الآن؟</span>
                    <p className="text-xs text-slate-200 leading-relaxed">
                      افتح البوت في تليجرام وأرسل أي ملف <strong>PDF كمستند (Document)</strong>. سيرد البوت خلال ثوانٍ!
                    </p>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleConnectBot} className="space-y-4">
                  <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/40 text-xs text-amber-200 space-y-1.5 leading-relaxed">
                    <p className="font-bold text-amber-300">
                      ⚠️ لماذا لم يصلك رد في المحاولة السابقة؟
                    </p>
                    <p>
                      لأن البوت كان مربوطاً بـ Webhook قديم على منصة n8n، ولم يكن محرك السيرفر الخلفي مفعلاً بعد. الآن عند إدخال التوكن بالأسفل والضغط على <strong>ربط وتشغيل البوت الآن</strong>، سيقوم السيرفر تلقائياً بإلغاء تعليق n8n القديم وتشغيل الاستقبال المباشر فوراً!
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="bot-token-input"
                      className="text-xs font-bold text-slate-200 block mb-2"
                    >
                      أدخل رمز توكن البوت (Telegram Bot Token):
                    </label>
                    <div className="flex flex-wrap sm:flex-nowrap gap-3">
                      <input
                        id="bot-token-input"
                        type="text"
                        value={botTokenInput}
                        onChange={(e) => setBotTokenInput(e.target.value)}
                        placeholder="مثال: 7123456789:AAHq_xxxxxxxxxxxxxxxxxxxxxxxx"
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-xs text-white font-mono focus:border-cyan-500 outline-none"
                        dir="ltr"
                      />
                      <button
                        type="submit"
                        disabled={isConnectingBot}
                        className="px-6 py-3 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-950 flex items-center gap-2 transition disabled:opacity-50 shrink-0"
                      >
                        <Power className="w-4 h-4" />
                        {isConnectingBot ? 'جاري التحقق والتشغيل...' : 'ربط وتشغيل البوت الآن'}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>

            {/* Live Incoming Telegram Jobs & Live Activity Log */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Incoming Telegram PDFs (7 cols) */}
              <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    <h3 className="font-bold text-white text-sm">
                      الملفات المستلمة من تليجرام ({telegramStatus.jobs.length})
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={fetchTelegramStatus}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    تحديث
                  </button>
                </div>

                {telegramStatus.jobs.length === 0 ? (
                  <div className="py-12 text-center space-y-2 text-slate-400 text-xs">
                    <Send className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                    <p className="font-semibold text-slate-300">
                      لا توجد ملفات مستلمة من تليجرام حتى الآن
                    </p>
                    <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                      بمجرد ربط التوكن وإرسال ملف PDF كمستند (Document) في محادثة البوت على تليجرام، سيظهر هنا فوراً ويتم الرد عليك في تليجرام تلقائياً.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {telegramStatus.jobs.map((job) => (
                      <div
                        key={job.id}
                        className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-bold text-white text-xs block">
                              {job.fileName}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              المرسل: {job.senderName} • المقاس: {job.widthMm}×{job.heightMm} مم • {job.pageCount} صفحة
                            </span>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                              job.status === 'completed'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : job.status === 'awaiting_choice'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : job.status === 'cancelled'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            }`}
                          >
                            {job.status === 'completed'
                              ? '✅ تم إرسال البروفة والزنكات'
                              : job.status === 'awaiting_choice'
                              ? '⏳ بانتظار اختيار الزر في تليجرام'
                              : job.status === 'cancelled'
                              ? '❌ ملغي'
                              : '⚙️ جاري المعالجة'}
                          </span>
                        </div>

                        {/* Quick Web Actions for this Telegram job */}
                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                          <button
                            type="button"
                            onClick={() =>
                              handleTriggerTelegramJobImposition(job.chatId, 'card_486x330')
                            }
                            className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 font-semibold transition"
                          >
                            إرسال مونتاج 48.6×33 سم لتليجرام
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleTriggerTelegramJobImposition(job.chatId, 'card_350x500')
                            }
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold transition"
                          >
                            إرسال مونتاج 50×35 سم
                          </button>
                          {job.hasCachedFiles && (
                            <>
                              <a
                                href={`/api/telegram/download/${job.chatId}/proof`}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1"
                              >
                                <Download className="w-3 h-3" />
                                البروفة
                              </a>
                              <a
                                href={`/api/telegram/download/${job.chatId}/print`}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1"
                              >
                                <Download className="w-3 h-3" />
                                الزنكات
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Live Bot Activity Log (5 cols) */}
              <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-bold text-white text-sm">
                      سجل عمليات البوت المباشر (Live Logs)
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">تحديث تلقائي</span>
                </div>

                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 text-xs">
                  {telegramStatus.logs.length === 0 ? (
                    <p className="text-slate-500 text-center py-8">
                      لا توجد أحداث مسجلة بعد. اربط التوكن لبدء المراقبة الحية.
                    </p>
                  ) : (
                    telegramStatus.logs.map((log) => (
                      <div
                        key={log.id}
                        className={`p-2.5 rounded-lg border text-[11px] leading-relaxed flex items-start justify-between gap-2 ${
                          log.type === 'error'
                            ? 'bg-rose-950/30 border-rose-900/50 text-rose-200'
                            : log.type === 'success'
                            ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-200'
                            : log.type === 'warning'
                            ? 'bg-amber-950/30 border-amber-900/50 text-amber-200'
                            : 'bg-slate-950/80 border-slate-800 text-slate-300'
                        }`}
                      >
                        <span>{log.message}</span>
                        <span className="font-mono text-[10px] text-slate-500 shrink-0">
                          {log.timestamp}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ALL-IN-ONE DIRECT PREPRESS STUDIO */}
        {activeTab === 'studio' && (
          <div className="space-y-6">
            {/* Top Grid: Dropzone & File Inspection Card */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Dropzone Column (5 cols) */}
              <div className="lg:col-span-5 space-y-4">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="application/pdf"
                  aria-label="رفع ملف PDF"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileUpload(e.target.files[0]);
                    }
                  }}
                />

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-7 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                    isDragging
                      ? 'border-cyan-400 bg-cyan-950/30 scale-[1.01]'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90'
                  }`}
                >
                  <div className="h-14 w-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-3 shadow-inner">
                    <Upload className="w-7 h-7" />
                  </div>
                  <h3 className="font-bold text-white text-sm mb-1">
                    اسحب ملف PDF وأفلته هنا، أو اضغط للاختيار
                  </h3>
                  <p className="text-xs text-slate-400 max-w-xs mb-4">
                    يدعم ملفات الكروت وجه واحد أو وجهين • يتم الفحص التلقائي بالمليمتر
                  </p>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        loadSamplePdf();
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      تجربة كارت قياسي (95×60)
                    </button>
                  </div>
                </div>

                {/* Quick Inspection Summary */}
                {inspection && (
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-cyan-400" />
                        <span className="font-bold text-xs text-white truncate max-w-[180px]">
                          {inspection.fileName}
                        </span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        inspection.isExact95x60
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}>
                        {inspection.isExact95x60 ? 'مقاس قياسي مضبوط' : 'مقاس خاص'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-300 border-t border-slate-800 pt-3">
                      <div className="p-2 rounded bg-slate-950/70">
                        <span className="text-slate-500 block text-[9px]">المقاس بالمليمتر:</span>
                        <strong className="text-white font-mono">{inspection.widthMm} × {inspection.heightMm}</strong>
                      </div>
                      <div className="p-2 rounded bg-slate-950/70">
                        <span className="text-slate-500 block text-[9px]">عدد الصفحات:</span>
                        <strong className="text-cyan-400 font-mono">
                          {inspection.pageCount === 2 ? 'وجه وظهر (2)' : `${inspection.pageCount} صفحة`}
                        </strong>
                      </div>
                      <div className="p-2 rounded bg-slate-950/70">
                        <span className="text-slate-500 block text-[9px]">حجم الملف:</span>
                        <strong className="text-slate-400 font-mono">
                          {(inspection.fileSizeBytes / 1024).toFixed(1)} KB
                        </strong>
                      </div>
                    </div>

                    {inspection.isExact95x60 ? (
                      <div className="text-[11px] text-emerald-400/90 bg-emerald-950/20 border border-emerald-900/40 p-2.5 rounded-lg flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          المقاس يتضمن 2.5 مم بليد داير ما يدور (صافي القص 90×55 مم). جاهز لمونتاج 25 كارت في الفرخ.
                        </span>
                      </div>
                    ) : (
                      <div className="text-[11px] text-amber-400/90 bg-amber-950/20 border border-amber-900/40 p-2.5 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          المقاس يختلف عن 95×60 مم. يمكنك إما تركيبه ككروت، أو اختيار توسيطه في منتصف الفرخ.
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Imposition Options & Export Actions (7 cols) */}
              <div className="lg:col-span-7 space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-cyan-400" />
                      <h3 className="font-bold text-white text-sm">خيارات المونتاج والفرخ</h3>
                    </div>
                    <span className="text-xs text-slate-400">
                      محرك المونتاج السحابي الداخلي
                    </span>
                  </div>

                  {/* Option 1: Sheet Size */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-300">
                      1. اختر مقاس الفرخ (Sheet Dimension):
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedSheet('486x330')}
                        className={`p-3 rounded-xl border text-right transition flex flex-col justify-between ${
                          selectedSheet === '486x330'
                            ? 'bg-cyan-500/15 border-cyan-500 text-white shadow-sm'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full mb-1">
                          <strong className="text-xs text-white">فرخ قياسي 48.6 × 33 سم</strong>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">486×330 مم</span>
                        </div>
                        <span className="text-[11px] text-slate-400">المقاس الأكثر استخداماً لمطابع الديجيتال والأوفست</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedSheet('350x500')}
                        className={`p-3 rounded-xl border text-right transition flex flex-col justify-between ${
                          selectedSheet === '350x500'
                            ? 'bg-cyan-500/15 border-cyan-500 text-white shadow-sm'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full mb-1">
                          <strong className="text-xs text-white">ربع فرخ 50 × 35 سم</strong>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">500×350 مم</span>
                        </div>
                        <span className="text-[11px] text-slate-400">مناسب للمقاسات الخاصة والماكينات ذات التغذية الأكبر</span>
                      </button>
                    </div>
                  </div>

                  {/* Option 2: Imposition Mode */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-300">
                      2. أسلوب التوزيع في الفرخ:
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setImpositionMode('cards_5x5')}
                        className={`p-3 rounded-xl border text-right transition ${
                          impositionMode === 'cards_5x5'
                            ? 'bg-cyan-500/15 border-cyan-500 text-white'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <strong className="text-xs text-white block mb-0.5">مونتاج 25 كارت (توزيع 5 × 5)</strong>
                        <span className="text-[11px] text-slate-400">Gap = 0 وسينيوهات خارجية 5 مم بلون التطابق</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setImpositionMode('center_sheet')}
                        className={`p-3 rounded-xl border text-right transition ${
                          impositionMode === 'center_sheet'
                            ? 'bg-cyan-500/15 border-cyan-500 text-white'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <strong className="text-xs text-white block mb-0.5">توسيط التصميم في منتصف الفرخ</strong>
                        <span className="text-[11px] text-slate-400">للملفات المفردة والبوسترات غير الكروت</span>
                      </button>
                    </div>
                  </div>

                  {/* Actions / Export Buttons */}
                  <div className="border-t border-slate-800 pt-4 space-y-3">
                    <label className="text-xs font-semibold text-slate-300 block">
                      3. تحميل ملفات الطباعة والبروفة فوراً:
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={isProcessing || !inspection}
                        onClick={() => handleExport('proof')}
                        className="py-2.5 px-4 rounded-xl font-bold text-xs bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center gap-2 shadow-lg shadow-cyan-900/30 transition disabled:opacity-50"
                      >
                        <Eye className="w-4 h-4" />
                        تحميل ملف البروفة (CLIENT_PROOF.pdf)
                      </button>

                      <button
                        type="button"
                        disabled={isProcessing || !inspection}
                        onClick={() => handleExport('print')}
                        className="py-2.5 px-4 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 transition disabled:opacity-50"
                      >
                        <Printer className="w-4 h-4" />
                        تحميل ملف الزنكات (PRINT_CMYK.pdf)
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={isProcessing || !inspection}
                      onClick={() => handleExport('both')}
                      className="w-full py-2 px-3 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center gap-2 transition disabled:opacity-50"
                    >
                      <Download className="w-4 h-4 text-cyan-400" />
                      تنزيل الملفين معاً بضغطة واحدة (Proof + Print)
                    </button>
                  </div>

                </div>
              </div>

            </div>

            {/* LIVE PREPRESS VISUALIZER CANVAS */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <Maximize2 className="w-4 h-4 text-cyan-400" />
                  <h3 className="font-bold text-white text-sm">
                    المعاينة الهندسية المباشرة للفرخ (Live Imposition Canvas)
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  {inspection && inspection.pageCount >= 2 && (
                    <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setActivePageIndex(0)}
                        className={`px-2.5 py-1 rounded font-semibold ${
                          activePageIndex === 0 ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        الوجه (Front)
                      </button>
                      <button
                        type="button"
                        onClick={() => setActivePageIndex(1)}
                        className={`px-2.5 py-1 rounded font-semibold ${
                          activePageIndex === 1 ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        الظهر (Back)
                      </button>
                    </div>
                  )}

                  <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setViewMode('proof')}
                      className={`px-2.5 py-1 rounded font-semibold ${
                        viewMode === 'proof' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      سينيوهات البروفة (سماوي)
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('print')}
                      className={`px-2.5 py-1 rounded font-semibold ${
                        viewMode === 'print' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      سينيوهات الطباعة (Registration)
                    </button>
                  </div>
                </div>
              </div>

              <div className="relative w-full aspect-[486/330] max-h-[500px] mx-auto bg-slate-950 rounded-xl border border-slate-700 shadow-2xl flex items-center justify-center p-8 overflow-hidden select-none">
                <div className="absolute top-3 right-4 text-[10px] font-mono text-slate-500 flex items-center gap-2">
                  <span>فرخ: {currentSheetConfig.widthMm} × {currentSheetConfig.heightMm} مم</span>
                  <span>•</span>
                  <span>{impositionMode === 'cards_5x5' ? '25 كارت (5 × 5)' : 'توسيط فردي'}</span>
                </div>
                <div className="absolute top-3 left-4 text-[10px] font-mono text-slate-500">
                  {viewMode === 'proof' ? 'CYAN HAIRLINE MARKS (5mm)' : 'REGISTRATION 100% CMYK MARKS'}
                </div>

                {impositionMode === 'cards_5x5' ? (
                  <div 
                    className="grid grid-cols-5 grid-rows-5 gap-0 border border-slate-800 shadow-2xl bg-slate-900/90 relative"
                    style={{
                      width: '88%',
                      height: '84%',
                    }}
                  >
                    <div className="absolute -top-4 left-0 right-0 flex justify-between pointer-events-none">
                      {[0, 1, 2, 3, 4, 5].map((idx) => (
                        <div
                          key={`top-${idx}`}
                          className="w-px h-3"
                          style={{
                            backgroundColor: viewMode === 'proof' ? '#06b6d4' : '#ffffff',
                            boxShadow: viewMode === 'proof' ? '0 0 3px #06b6d4' : 'none'
                          }}
                        />
                      ))}
                    </div>

                    <div className="absolute -bottom-4 left-0 right-0 flex justify-between pointer-events-none">
                      {[0, 1, 2, 3, 4, 5].map((idx) => (
                        <div
                          key={`bottom-${idx}`}
                          className="w-px h-3"
                          style={{
                            backgroundColor: viewMode === 'proof' ? '#06b6d4' : '#ffffff',
                            boxShadow: viewMode === 'proof' ? '0 0 3px #06b6d4' : 'none'
                          }}
                        />
                      ))}
                    </div>

                    <div className="absolute top-0 bottom-0 -left-4 flex flex-col justify-between pointer-events-none">
                      {[0, 1, 2, 3, 4, 5].map((idx) => (
                        <div
                          key={`left-${idx}`}
                          className="h-px w-3"
                          style={{
                            backgroundColor: viewMode === 'proof' ? '#06b6d4' : '#ffffff',
                            boxShadow: viewMode === 'proof' ? '0 0 3px #06b6d4' : 'none'
                          }}
                        />
                      ))}
                    </div>

                    <div className="absolute top-0 bottom-0 -right-4 flex flex-col justify-between pointer-events-none">
                      {[0, 1, 2, 3, 4, 5].map((idx) => (
                        <div
                          key={`right-${idx}`}
                          className="h-px w-3"
                          style={{
                            backgroundColor: viewMode === 'proof' ? '#06b6d4' : '#ffffff',
                            boxShadow: viewMode === 'proof' ? '0 0 3px #06b6d4' : 'none'
                          }}
                        />
                      ))}
                    </div>

                    {Array.from({ length: 25 }).map((_, index) => (
                      <div
                        key={index}
                        className="border border-slate-800/60 relative p-1 flex flex-col items-center justify-center group hover:bg-cyan-950/20 transition cursor-default"
                      >
                        <div className="w-full h-full rounded-sm border border-dashed border-amber-400/25 flex flex-col items-center justify-center p-1 bg-gradient-to-br from-slate-900 to-slate-950 group-hover:border-cyan-400/60">
                          <span className="text-[9px] font-mono font-bold text-slate-400 group-hover:text-cyan-300">
                            #{index + 1}
                          </span>
                          <span className="text-[7px] text-slate-500">
                            {activePageIndex === 1 ? 'ظهر' : 'وجه'} 90×55
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="w-48 h-32 rounded-lg border-2 border-dashed border-cyan-400/60 bg-slate-900/90 flex flex-col items-center justify-center p-3 shadow-2xl">
                    <span className="text-xs font-bold text-cyan-300">تصميم مفرد موسط</span>
                    <span className="text-[10px] text-slate-400 mt-1 font-mono">
                      {inspection ? `${inspection.widthMm} × ${inspection.heightMm} مم` : 'مقاس العمل'}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-2">
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">بلوك الكارت (مع البليد):</span>
                  <span className="font-bold text-white font-mono">95 × 60 مم</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">مقاس القص الصافي:</span>
                  <span className="font-bold text-amber-400 font-mono">90 × 55 مم (بليد 2.5 مم)</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">المسافة بين الكروت (Gap):</span>
                  <span className="font-bold text-emerald-400 font-mono">0.0 مم (لاصق تماماً)</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">طول ومسافة السينيوهات:</span>
                  <span className="font-bold text-cyan-400 font-mono">طول 5 مم • تبعد 3 مم</span>
                </div>
              </div>
            </div>

            {jobHistory.length > 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-3">
                <h3 className="font-bold text-white text-xs flex items-center gap-2">
                  <FileText className="w-4 h-4 text-cyan-400" />
                  سجل العمليات المعالجة في المتصفح
                </h3>
                <div className="divide-y divide-slate-800/70 text-xs">
                  {jobHistory.map((job) => (
                    <div key={job.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 truncate">
                        <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                        <span className="font-mono text-white truncate">{job.fileName}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-slate-400">
                        <span className="font-mono text-[11px]">{job.dimensionsMm}</span>
                        <span className="font-mono text-[11px] text-slate-500">{job.timestamp}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* TAB 3: FREE DEPLOYMENT & SYSTEM GUIDE */}
        {activeTab === 'guide' && (
          <div className="space-y-6">
            {/* Step-by-Step Free Cloud Hosting Guide */}
            <div className="rounded-2xl border border-cyan-800/50 bg-slate-900/70 p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <h2 className="font-bold text-white text-base">
                    🚀 خطوات رفع وتشغيل النظام مجاناً مدى الحياة (GitHub + Render / Koyeb)
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    تم تجهيز المشروع بملفي <code className="text-cyan-300 font-mono">render.yaml</code> و <code className="text-cyan-300 font-mono">Dockerfile</code> ونقطة فحص <code className="text-emerald-400 font-mono">/api/health</code> ليعمل مجاناً 24/7.
                  </p>
                </div>
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  100% Free Hosting Ready
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Step 1 */}
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                    الخطوة 1: رفع الكود على GitHub
                  </span>
                  <p className="text-slate-300 leading-relaxed">
                    من أعلى يمين شاشة Google AI Studio، اضغط على أيقونة <strong>GitHub / Export to GitHub</strong> (أو قم بتحميل المشروع ZIP ورفعه إلى مستودع GitHub جديد خاص بك).
                  </p>
                </div>

                {/* Step 2 */}
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                    الخطوة 2: الربط المجاني على Render.com أو Koyeb
                  </span>
                  <p className="text-slate-300 leading-relaxed">
                    افتح موقع <strong>render.com</strong> (أو <strong>koyeb.com</strong>) وسجل دخولك بحساب GitHub، ثم اختر <strong>New Web Service</strong> واختر المستودع، وحدد الخطة المجانية <strong>Free Plan ($0/month)</strong>.
                  </p>
                </div>

                {/* Step 3 */}
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                    الخطوة 3: أوامر التشغيل ومتغير التوكن (Environment Variable)
                  </span>
                  <div className="space-y-1.5 font-mono text-[11px] bg-slate-900 p-2.5 rounded-lg border border-slate-800 text-slate-200" dir="ltr">
                    <div><span className="text-slate-500">Build Command:</span> npm install && npm run build</div>
                    <div><span className="text-slate-500">Start Command:</span> npm run start</div>
                    <div><span className="text-emerald-400">Env Var Key:</span> TELEGRAM_BOT_TOKEN</div>
                    <div><span className="text-emerald-400">Env Var Value:</span> (ضع توكن بوت التليجرام هنا)</div>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    وضع <code className="text-emerald-300">TELEGRAM_BOT_TOKEN</code> في الـ Environment Variables يجعل البوت يتصل تلقائياً فور تشغيل السيرفر دون الحاجة لإدخاله يدوياً!
                  </p>
                </div>

                {/* Step 4 */}
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">
                    الخطوة 4: إبقاء السيرفر المجاني مستيقظاً 24/7 (Keep-Alive)
                  </span>
                  <p className="text-slate-300 leading-relaxed">
                    الخطط المجانية على Render تنام بعد 15 دقيقة من عدم الاستخدام. لإبقائها مستيقظة 24 ساعة مجاناً، سجل في موقع <strong>cron-job.org</strong> أو <strong>UptimeRobot.com</strong> (مجاني) وأضف رابط فحص السيرفر كل 10 دقائق:
                  </p>
                  <div className="font-mono text-[11px] bg-slate-900 p-2 rounded border border-slate-800 text-cyan-300" dir="ltr">
                    https://your-app-name.onrender.com/api/health
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              
              <div className="rounded-2xl border border-rose-900/40 bg-slate-900/60 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-rose-300 text-sm">النظام القديم (محلي + Pinggy + n8n)</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    معقد وعرضة للانقطاع
                  </span>
                </div>
                <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside leading-relaxed">
                  <li>يتطلب بقاء جهاز الماك مفتوحاً وشغالاً طوال الوقت.</li>
                  <li>تشغيل يدوي لسكربت التيرمنال <code className="text-rose-400">start_prepress.command</code>.</li>
                  <li>رابط Pinggy المجاني يتغير وينتهي كل ساعة أو عند غلق التيرمنال.</li>
                  <li>ضرورة فتح n8n وتعديل الرابط يدوياً في العقدتين 4 و 9 عند كل تغيير.</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-emerald-900/40 bg-slate-900/60 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-emerald-300 text-sm">النظام الجديد (Cloud Studio + Telegram Engine)</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    مستقر 24/7 وفي مكان واحد
                  </span>
                </div>
                <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside leading-relaxed">
                  <li>يربط بوت تليجرام مباشرة بالسيرفر السحابي هنا عبر Long Polling تلقائي.</li>
                  <li>يلغي أي Webhook قديم معلق من n8n بمجرد إدخال التوكن.</li>
                  <li>يفحص المقاس (95×60 مم) ويرد على العميل في تليجرام بالأزرار التفاعلية وملفي البروفة والطباعة.</li>
                  <li>كما يتيح لك رفع وتجهيز الملفات مباشرة من المتصفح في نفس المكان.</li>
                </ul>
              </div>

            </div>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-3.5 px-6 text-center text-xs text-slate-500">
        Prepress Cloud Studio • نظام المونتاج السحابي المتكامل (تليجرام + متصفح مباشر)
      </footer>
    </div>
  );
}
