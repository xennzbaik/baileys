import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeInMemoryStore,
  Browsers,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  proto
} from '@whiskeysockets/baileys';

import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode-terminal';
import fs from 'fs-extra';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import cron from 'node-cron';
import sqlite3 from 'sqlite3';
import sharp from 'sharp';
import express from 'express';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';

// ============ WATERMARK ============
function showWatermark() {
  console.log(chalk.cyan('\n[ aqeell/baileys ] v10.0.0 - Ultimate Edition'));
  console.log(chalk.gray('Auto Join | Mass DM | Multi-Session | Anti-Ban | Backup | Scheduler | Webhook'));
  console.log(chalk.yellow('Thanks for using my baileys @aqeel'));
  console.log(chalk.yellow('Contact: t.me/tflahh\n'));
}

// ============ CONFIG ============
export interface BotConfig {
  ownerNumber: string;
  botName: string;
  prefix: string;
  sessionDir: string;
  mediaDir: string;
  backupDir: string;
  autoRead: boolean;
  pairingCode: boolean;
  maxRetries: number;
  
  // FITUR LANGKA 1: AUTO JOIN
  autoJoinChannel: {
    enabled: boolean;
    channelInvite: string;
    retryOnFail: boolean;
    retryCount: number;
  };
  
  // FITUR LANGKA 2: MULTI-SESSION
  multiSession: {
    enabled: boolean;
    numbers: string[];
  };
  
  // FITUR LANGKA 3: AUTO BACKUP
  autoBackup: {
    enabled: boolean;
    intervalHours: number;
    telegramBotToken?: string;
    telegramChatId?: string;
    googleDriveFolder?: string;
  };
  
  // FITUR LANGKA 4: SCHEDULE MESSAGE
  scheduler: {
    enabled: boolean;
    jobs: Array<{
      cron: string;
      jid: string;
      message: string;
    }>;
  };
  
  // FITUR LANGKA 5: WEBHOOK
  webhook: {
    enabled: boolean;
    url: string;
    secret: string;
  };
  
  // FITUR LANGKA 6: DATABASE AUTO REPLY
  autoReplyDB: {
    enabled: boolean;
    dbPath: string;
  };
  
  // FITUR LANGKA 7: MEDIA COMPRESSOR
  mediaCompressor: {
    enabled: boolean;
    imageQuality: number;
    videoQuality: number;
  };
  
  // FITUR LANGKA 8: ANTI BAN
  antiBan: {
    enabled: boolean;
    minDelay: number;
    maxDelay: number;
    maxMessagesPerMinute: number;
    adaptiveMode: boolean;
  };
}

const defaultConfig: BotConfig = {
  ownerNumber: '628xxxxxxxxx@s.whatsapp.net',
  botName: 'AqeellBot',
  prefix: '.',
  sessionDir: './sessions',
  mediaDir: './media',
  backupDir: './backups',
  autoRead: true,
  pairingCode: true,
  maxRetries: 10,
  
  autoJoinChannel: {
    enabled: false,
    channelInvite: '',
    retryOnFail: true,
    retryCount: 5
  },
  
  multiSession: {
    enabled: false,
    numbers: []
  },
  
  autoBackup: {
    enabled: false,
    intervalHours: 6
  },
  
  scheduler: {
    enabled: false,
    jobs: []
  },
  
  webhook: {
    enabled: false,
    url: '',
    secret: ''
  },
  
  autoReplyDB: {
    enabled: false,
    dbPath: './replies.db'
  },
  
  mediaCompressor: {
    enabled: true,
    imageQuality: 80,
    videoQuality: 70
  },
  
  antiBan: {
    enabled: true,
    minDelay: 1000,
    maxDelay: 3000,
    maxMessagesPerMinute: 30,
    adaptiveMode: true
  }
};

// ============ FITUR LANGKA 1: AUTO JOIN CHANNEL ============
class AutoJoinChannel {
  private config: any;
  private hasJoined: boolean = false;

  constructor(config: any) {
    this.config = config;
  }

  async join(sock: any): Promise<boolean> {
    if (!this.config.enabled) return false;
    if (this.hasJoined) return true;
    if (!this.config.channelInvite) return false;

    let attempt = 0;
    while (attempt < this.config.retryCount) {
      attempt++;
      try {
        const result = await sock.groupAcceptInvite(this.config.channelInvite);
        console.log(chalk.green(`[ Auto-Join ] Success: ${result}`));
        this.hasJoined = true;
        return true;
      } catch (err: any) {
        console.log(chalk.yellow(`[ Auto-Join ] Attempt ${attempt} failed: ${err.message}`));
        if (attempt < this.config.retryCount) await this.delay(5000);
      }
    }
    return false;
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ FITUR LANGKA 2: MULTI-SESSION MANAGER ============
class MultiSessionManager {
  private sessions: Map<string, any> = new Map();
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async startAll(): Promise<Map<string, any>> {
    if (!this.config.enabled) return this.sessions;

    for (const number of this.config.numbers) {
      try {
        const session = await this.startSession(number);
        this.sessions.set(number, session);
        console.log(chalk.green(`[ Multi-Session ] Started: ${number}`));
      } catch (err) {
        console.log(chalk.red(`[ Multi-Session ] Failed: ${number} - ${err.message}`));
      }
    }
    return this.sessions;
  }

  private async startSession(number: string): Promise<any> {
    const sessionDir = `./sessions_${number}`;
    await fs.ensureDir(sessionDir);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const sock = makeWASocket({
      logger: pino().child({ level: 'silent' }),
      auth: state,
      browser: Browsers.macOS(`Bot-${number}`),
      markOnlineOnConnect: true
    });
    
    sock.ev.on('creds.update', saveCreds);
    return sock;
  }

  getSession(number: string) {
    return this.sessions.get(number);
  }

  getAllSessions() {
    return Array.from(this.sessions.entries());
  }
}

// ============ FITUR LANGKA 3: AUTO BACKUP ============
class AutoBackup {
  private config: any;
  private backupInterval: NodeJS.Timeout | null = null;

  constructor(config: any) {
    this.config = config;
  }

  start(sessionDir: string) {
    if (!this.config.enabled) return;
    
    this.backupInterval = setInterval(async () => {
      await this.doBackup(sessionDir);
    }, this.config.intervalHours * 60 * 60 * 1000);
    
    console.log(chalk.gray(`[ Auto-Backup ] Every ${this.config.intervalHours} hours`));
  }

  async doBackup(sessionDir: string): Promise<boolean> {
    try {
      const date = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const backupPath = `./backups/session-${date}.zip`;
      
      await fs.ensureDir('./backups');
      
      // Simple backup: copy folder
      await fs.copy(sessionDir, backupPath);
      
      console.log(chalk.green(`[ Auto-Backup ] Success: ${backupPath}`));
      
      // Backup to Telegram if configured
      if (this.config.telegramBotToken && this.config.telegramChatId) {
        await this.sendToTelegram(backupPath);
      }
      
      return true;
    } catch (err) {
      console.log(chalk.red(`[ Auto-Backup ] Failed: ${err.message}`));
      return false;
    }
  }

  private async sendToTelegram(filePath: string): Promise<void> {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendDocument`;
      const formData = new FormData();
      formData.append('chat_id', this.config.telegramChatId);
      formData.append('document', new Blob([fileBuffer]), filePath.split('/').pop());
      
      await fetch(url, { method: 'POST', body: formData });
      console.log(chalk.gray('[ Auto-Backup ] Sent to Telegram'));
    } catch (err) {
      console.log(chalk.red(`[ Auto-Backup ] Telegram send failed: ${err.message}`));
    }
  }

  async restore(backupPath: string, destDir: string): Promise<boolean> {
    try {
      await fs.copy(backupPath, destDir);
      console.log(chalk.green(`[ Auto-Backup ] Restored: ${backupPath} -> ${destDir}`));
      return true;
    } catch (err) {
      console.log(chalk.red(`[ Auto-Backup ] Restore failed: ${err.message}`));
      return false;
    }
  }

  stop() {
    if (this.backupInterval) clearInterval(this.backupInterval);
  }
}

// ============ FITUR LANGKA 4: SCHEDULE MESSAGE ============
class MessageScheduler {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private config: any;
  private sock: any;

  constructor(config: any) {
    this.config = config;
  }

  setSocket(sock: any) {
    this.sock = sock;
  }

  start() {
    if (!this.config.enabled) return;
    
    for (const job of this.config.jobs) {
      this.addJob(job.cron, job.jid, job.message);
    }
    
    console.log(chalk.gray(`[ Scheduler ] ${this.jobs.size} jobs active`));
  }

  addJob(cronExpression: string, jid: string, message: string): string {
    const id = `${jid}_${Date.now()}`;
    const task = cron.schedule(cronExpression, async () => {
      try {
        await this.sock?.sendMessage(jid, { text: message });
        console.log(chalk.gray(`[ Scheduler ] Sent to ${jid}`));
      } catch (err) {
        console.log(chalk.red(`[ Scheduler ] Failed: ${err.message}`));
      }
    });
    
    this.jobs.set(id, task);
    return id;
  }

  removeJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
      return true;
    }
    return false;
  }

  listJobs(): Array<{ id: string }> {
    return Array.from(this.jobs.keys()).map(id => ({ id }));
  }
}

// ============ FITUR LANGKA 5: WEBHOOK SYSTEM ============
class WebhookSystem {
  private config: any;
  private queue: any[] = [];

  constructor(config: any) {
    this.config = config;
  }

  async send(event: string, data: any): Promise<boolean> {
    if (!this.config.enabled) return false;
    
    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': this.config.secret
        },
        body: JSON.stringify({ event, data, timestamp: Date.now() })
      });
      
      return response.ok;
    } catch (err) {
      // Queue for retry
      this.queue.push({ event, data, retry: 0 });
      return false;
    }
  }

  async processQueue() {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item && item.retry < 3) {
        const success = await this.send(item.event, item.data);
        if (!success) {
          item.retry++;
          this.queue.push(item);
        }
      }
    }
  }
}

// ============ FITUR LANGKA 6: DATABASE AUTO REPLY ============
class AutoReplyDatabase {
  private db: sqlite3.Database;
  private config: any;

  constructor(config: any) {
    this.config = config;
    this.db = new sqlite3.Database(config.dbPath);
    this.init();
  }

  private init() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT NOT NULL,
        response TEXT NOT NULL,
        type TEXT DEFAULT 'exact',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  addRule(keyword: string, response: string, type: string = 'exact'): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO replies (keyword, response, type) VALUES (?, ?, ?)',
        [keyword.toLowerCase(), response, type],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getReply(message: string): Promise<string | null> {
    const lowerMsg = message.toLowerCase();
    
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT keyword, response, type FROM replies',
        [],
        (err, rows: any[]) => {
          if (err) reject(err);
          
          for (const row of rows) {
            if (row.type === 'exact' && lowerMsg === row.keyword) {
              resolve(row.response);
              return;
            }
            if (row.type === 'contains' && lowerMsg.includes(row.keyword)) {
              resolve(row.response);
              return;
            }
            if (row.type === 'regex') {
              const regex = new RegExp(row.keyword, 'i');
              if (regex.test(lowerMsg)) {
                resolve(row.response);
                return;
              }
            }
          }
          resolve(null);
        }
      );
    });
  }

  importFromJSON(filePath: string): Promise<number> {
    return new Promise(async (resolve, reject) => {
      try {
        const data = await fs.readJSON(filePath);
        let count = 0;
        for (const item of data) {
          await this.addRule(item.keyword, item.response, item.type || 'exact');
          count++;
        }
        resolve(count);
      } catch (err) {
        reject(err);
      }
    });
  }

  close() {
    this.db.close();
  }
}

// ============ FITUR LANGKA 7: MEDIA COMPRESSOR ============
class MediaCompressor {
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async compressImage(buffer: Buffer): Promise<Buffer> {
    if (!this.config.enabled) return buffer;
    
    return sharp(buffer)
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: this.config.imageQuality })
      .toBuffer();
  }

  async compressVideo(buffer: Buffer): Promise<Buffer> {
    if (!this.config.enabled) return buffer;
    // Note: Video compression requires ffmpeg
    // This is a placeholder - implement with fluent-ffmpeg
    return buffer;
  }
}

// ============ FITUR LANGKA 8: ANTI BAN SYSTEM ============
class AntiBanSystem {
  private config: any;
  private messageTimestamps: number[] = [];
  private isRateLimited: boolean = false;
  private adaptiveDelay: number = 1000;

  constructor(config: any) {
    this.config = config;
  }

  async delay(): Promise<number> {
    if (!this.config.enabled) return 0;
    
    this.checkRateLimit();
    
    if (this.isRateLimited) {
      console.log(chalk.yellow('[ Anti-Ban ] Rate limit reached, waiting 60s...'));
      await this.sleep(60000);
      this.isRateLimited = false;
      this.messageTimestamps = [];
    }
    
    let delayTime = Math.floor(Math.random() * (this.config.maxDelay - this.config.minDelay + 1) + this.config.minDelay);
    
    if (this.config.adaptiveMode) {
      delayTime = this.adaptiveDelay;
      this.adaptiveDelay = Math.min(this.adaptiveDelay + 100, this.config.maxDelay);
    }
    
    await this.sleep(delayTime);
    return delayTime;
  }

  private checkRateLimit() {
    const now = Date.now();
    this.messageTimestamps = this.messageTimestamps.filter(t => t > now - 60000);
    
    if (this.messageTimestamps.length >= this.config.maxMessagesPerMinute) {
      this.isRateLimited = true;
    }
    this.messageTimestamps.push(now);
  }

  resetAdaptiveDelay() {
    this.adaptiveDelay = this.config.minDelay;
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ MASS JOIN ============
class MassJoin {
  async join(sock: any, inviteCode: string): Promise<boolean> {
    try {
      await sock.groupAcceptInvite(inviteCode);
      return true;
    } catch {
      return false;
    }
  }
  
  async massJoin(sock: any, invites: string[]): Promise<{ success: number; fail: number; details: any[] }> {
    let success = 0, fail = 0;
    const details: any[] = [];
    
    for (const invite of invites) {
      try {
        await sock.groupAcceptInvite(invite.trim());
        success++;
        details.push({ invite, status: 'success' });
        await this.delay(2000);
      } catch (err: any) {
        fail++;
        details.push({ invite, status: 'failed', error: err.message });
      }
    }
    return { success, fail, details };
  }
  
  async massJoinFromFile(sock: any, filePath: string): Promise<{ success: number; fail: number }> {
    if (!await fs.pathExists(filePath)) return { success: 0, fail: 0 };
    const content = await fs.readFile(filePath, 'utf-8');
    const invites = content.split('\n').filter(line => line.trim().length > 0);
    const result = await this.massJoin(sock, invites);
    return { success: result.success, fail: result.fail };
  }
  
  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ MASS DM ============
class MassDM {
  async broadcast(sock: any, jids: string[], message: string): Promise<{ sent: number; failed: number }> {
    let sent = 0, failed = 0;
    for (const jid of jids) {
      try {
        await sock.sendMessage(jid, { text: message });
        sent++;
        await this.delay(1500);
      } catch {
        failed++;
      }
    }
    return { sent, failed };
  }
  
  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ CONTACT SCRAPER ============
class ContactScraper {
  async fromGroup(sock: any, groupJid: string): Promise<any[]> {
    try {
      const metadata = await sock.groupMetadata(groupJid);
      return metadata.participants.map(p => ({
        jid: p.id,
        name: p.notify || p.id.split('@')[0],
        admin: p.admin || false
      }));
    } catch {
      return [];
    }
  }
  
  async fromAllGroups(sock: any, store: any): Promise<any[]> {
    const groups = store.chats.all().filter((c: any) => c.id.endsWith('@g.us'));
    let allContacts: any[] = [];
    for (const group of groups) {
      const contacts = await this.fromGroup(sock, group.id);
      allContacts = [...allContacts, ...contacts];
      await this.delay(1000);
    }
    return allContacts;
  }
  
  async saveToFile(contacts: any[], filePath: string): Promise<void> {
    await fs.writeJSON(filePath, contacts, { spaces: 2 });
  }
  
  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ PHONE CHECKER ============
class PhoneChecker {
  async check(sock: any, number: string): Promise<{ number: string; exists: boolean; jid: string | null }> {
    const jid = `${number}@s.whatsapp.net`;
    try {
      await sock.presenceSubscribe(jid);
      return { number, exists: true, jid };
    } catch {
      return { number, exists: false, jid: null };
    }
  }
  
  async checkMultiple(sock: any, numbers: string[]): Promise<any[]> {
    const results = [];
    for (const number of numbers) {
      results.push(await this.check(sock, number));
      await this.delay(1000);
    }
    return results;
  }
  
  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ CHANNEL CHECKER ============
class ChannelChecker {
  async check(sock: any, inviteCode: string): Promise<any> {
    try {
      const info = await sock.getInviteInfo(inviteCode);
      return {
        id: info.id,
        name: info.subject,
        description: info.desc || 'No description',
        memberCount: info.size,
        isGroup: info.isGroup,
        inviteCode: inviteCode
      };
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  }
  
  async fromLink(sock: any, link: string): Promise<any> {
    const code = this.extractCode(link);
    if (!code) return { error: true, message: 'Invalid WhatsApp link' };
    return this.check(sock, code);
  }
  
  private extractCode(link: string): string | null {
    const patterns = [
      /https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9]+)/,
      /https:\/\/whatsapp\.com\/channel\/([A-Za-z0-9]+)/,
      /https:\/\/wa\.me\/([A-Za-z0-9]+)/,
      /([A-Za-z0-9]{22})/
    ];
    for (const pattern of patterns) {
      const match = link.match(pattern);
      if (match) return match[1];
    }
    return null;
  }
}

// ============ MAIN CLASS ============
export class AqeellBaileys extends EventEmitter {
  private sock: any;
  private store: any;
  private config: BotConfig;
  private retryCount: number = 0;
  
  // Feature instances
  public autoJoinChannel: AutoJoinChannel;
  public multiSession: MultiSessionManager;
  public autoBackup: AutoBackup;
  public scheduler: MessageScheduler;
  public webhook: WebhookSystem;
  public autoReplyDB: AutoReplyDatabase;
  public mediaCompressor: MediaCompressor;
  public antiBan: AntiBanSystem;
  public massJoin: MassJoin;
  public massDM: MassDM;
  public contactScraper: ContactScraper;
  public phoneChecker: PhoneChecker;
  public channelChecker: ChannelChecker;

  constructor(config: Partial<BotConfig> = {}) {
    super();
    this.config = { ...defaultConfig, ...config };
    showWatermark();
    
    // Initialize all features
    this.autoJoinChannel = new AutoJoinChannel(this.config.autoJoinChannel);
    this.multiSession = new MultiSessionManager(this.config.multiSession);
    this.autoBackup = new AutoBackup(this.config.autoBackup);
    this.scheduler = new MessageScheduler(this.config.scheduler);
    this.webhook = new WebhookSystem(this.config.webhook);
    this.autoReplyDB = new AutoReplyDatabase(this.config.autoReplyDB);
    this.mediaCompressor = new MediaCompressor(this.config.mediaCompressor);
    this.antiBan = new AntiBanSystem(this.config.antiBan);
    this.massJoin = new MassJoin();
    this.massDM = new MassDM();
    this.contactScraper = new ContactScraper();
    this.phoneChecker = new PhoneChecker();
    this.channelChecker = new ChannelChecker();
    
    this.init();
  }

  private async init() {
    await fs.ensureDir(this.config.sessionDir);
    await fs.ensureDir(this.config.mediaDir);
    await fs.ensureDir(this.config.backupDir);
    
    await this.start();
    console.log(chalk.green('[ OK ] Bot ready\n'));
    
    // Start features
    await this.autoJoinChannel.join(this.sock);
    await this.multiSession.startAll();
    this.autoBackup.start(this.config.sessionDir);
    this.scheduler.setSocket(this.sock);
    this.scheduler.start();
  }

  async start() {
    const { version } = await fetchLatestBaileysVersion();
    console.log(chalk.gray(`[ Baileys ] v${version}`));

    const { state, saveCreds } = await useMultiFileAuthState(this.config.sessionDir);
    
    this.store = makeInMemoryStore({ 
      logger: pino().child({ level: 'silent' }),
      saveInFile: true
    });
    
    this.store.readFromFile('./store.json');
    setInterval(() => this.store.writeToFile('./store.json'), 30_000);

    this.sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.macOS(this.config.botName),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      keepAliveIntervalMs: 15000
    });

    this.store.bind(this.sock.ev);
    
    this.sock.ev.on('connection.update', this.handleConnection.bind(this));
    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('messages.upsert', this.handleMessages.bind(this));
  }

  private async handleConnection(update: any) {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr && !this.config.pairingCode) {
      console.log(chalk.yellow('\n[ QR Code ] Scan this:\n'));
      QRCode.generate(qr, { small: true });
      this.emit('qr', qr);
    }
    
    if (connection === 'open') {
      console.log(chalk.green(`[ Online ] ${this.sock.user?.name}`));
      console.log(chalk.gray(`[ ID ] ${this.sock.user?.id}`));
      this.emit('connected', this.sock.user);
      this.retryCount = 0;
      this.antiBan.resetAdaptiveDelay();
    }
    
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      console.log(chalk.yellow(`[ Disconnected ] code: ${statusCode}`));
      
      if (statusCode !== DisconnectReason.loggedOut && this.retryCount < this.config.maxRetries) {
        this.retryCount++;
        console.log(chalk.gray(`[ Retry ] ${this.retryCount}/${this.config.maxRetries}`));
        setTimeout(() => this.start(), 5000);
      }
    }
  }

  private async handleMessages({ messages, type }: any) {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message) return;
    
    await this.antiBan.delay();
    
    if (this.config.autoRead && !msg.key.fromMe) {
      await this.sock.readMessages([msg.key]);
    }
    
    // Extract text
    let text = '';
    if (msg.message.conversation) text = msg.message.conversation;
    else if (msg.message.extendedTextMessage) text = msg.message.extendedTextMessage.text;
    
    // Auto reply from database
    if (this.config.autoReplyDB.enabled && text) {
      const reply = await this.autoReplyDB.getReply(text);
      if (reply) {
        await this.sendMessage(msg.key.remoteJid, { text: reply });
      }
    }
    
    // Send to webhook
    await this.webhook.send('message', {
      from: msg.key.remoteJid,
      text,
      timestamp: msg.messageTimestamp
    });
    
    this.emit('message', msg);
  }

  async sendMessage(jid: string, content: any) {
    return this.sock.sendMessage(jid, content);
  }
  
  async sendCompressedImage(jid: string, buffer: Buffer, caption?: string) {
    const compressed = await this.mediaCompressor.compressImage(buffer);
    return this.sock.sendMessage(jid, { image: compressed, caption });
  }
  
  async downloadMedia(msg: any): Promise<Buffer> {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
      reuploadRequest: this.sock.updateMediaMessage
    });
    return Buffer.from(buffer);
  }
  
  async getGroupMetadata(jid: string) {
    return this.sock.groupMetadata(jid);
  }
  
  async getAllGroups() {
    return this.store.chats.all().filter((c: any) => c.id.endsWith('@g.us'));
  }
  
  async getAllChats() {
    return this.store.chats.all();
  }
  
  getSocket() {
    return this.sock;
  }
  
  getStore() {
    return this.store;
  }
  
  async logout() {
    await this.sock.logout();
  }
}

export default AqeellBaileys;
