import { AqeellBaileys } from '../index';
import { proto } from '@whiskeysockets/baileys';
import chalk from 'chalk';

interface Command {
  name: string;
  aliases?: string[];
  description: string;
  execute: (bot: AqeellBaileys, msg: proto.IWebMessageInfo, args: string[]) => Promise<void>;
}

export class CommandHandler {
  private commands: Map<string, Command> = new Map();
  private bot: AqeellBaileys;

  constructor(bot: AqeellBaileys) {
    this.bot = bot;
    this.registerCommands();
    this.setupListener();
  }

  private registerCommands() {
    // Mass DM Command
    this.addCommand({
      name: 'massdm',
      aliases: ['mdm', 'broadcast'],
      description: 'Send mass DM to contacts',
      execute: async (bot, msg, args) => {
        const text = args.join(' ');
        if (!text) {
          await bot.sendMessage(msg.key.remoteJid!, { text: 'Usage: .massdm <message>' });
          return;
        }
        
        await bot.sendMessage(msg.key.remoteJid!, { text: '⏳ Collecting contacts...' });
        const contacts = await bot.contactScraper.fromAllGroups(bot.getSocket(), bot.getStore());
        const result = await bot.massDM.broadcast(bot.getSocket(), contacts.map(c => c.jid), text);
        
        await bot.sendMessage(msg.key.remoteJid!, { 
          text: `✅ Mass DM Complete\n📨 Sent: ${result.sent}\n❌ Failed: ${result.failed}\n👥 Total: ${contacts.length}` 
        });
      }
    });

    // Mass Join Command
    this.addCommand({
      name: 'massjoin',
      aliases: ['mj', 'joinall'],
      description: 'Mass join WhatsApp groups from file or list',
      execute: async (bot, msg, args) => {
        const source = args[0];
        let result;
        
        if (source === 'file') {
          result = await bot.massJoin.massJoinFromFile(bot.getSocket(), './invites.txt');
        } else if (args.length > 0) {
          result = await bot.massJoin.massJoin(bot.getSocket(), args);
        } else {
          await bot.sendMessage(msg.key.remoteJid!, { text: 'Usage: .massjoin invite1 invite2 OR .massjoin file' });
          return;
        }
        
        await bot.sendMessage(msg.key.remoteJid!, { 
          text: `✅ Mass Join Complete\n✅ Success: ${result.success}\n❌ Failed: ${result.fail}` 
        });
      }
    });

    // Scrape Contacts Command
    this.addCommand({
      name: 'scrape',
      aliases: ['sc', 'getcontacts'],
      description: 'Scrape all contacts from groups',
      execute: async (bot, msg, args) => {
        await bot.sendMessage(msg.key.remoteJid!, { text: '⏳ Scraping contacts...' });
        const contacts = await bot.contactScraper.fromAllGroups(bot.getSocket(), bot.getStore());
        await bot.contactScraper.saveToFile(contacts, './contacts.json');
        
        await bot.sendMessage(msg.key.remoteJid!, { 
          text: `✅ Scraped ${contacts.length} contacts\n📁 Saved to contacts.json` 
        });
      }
    });

    // Phone Checker Command
    this.addCommand({
      name: 'check',
      aliases: ['cek'],
      description: 'Check if number is on WhatsApp',
      execute: async (bot, msg, args) => {
        const number = args[0];
        if (!number) {
          await bot.sendMessage(msg.key.remoteJid!, { text: 'Usage: .check 628xxxxxxxxx' });
          return;
        }
        
        const result = await bot.phoneChecker.check(bot.getSocket(), number);
        await bot.sendMessage(msg.key.remoteJid!, { 
          text: result.exists 
            ? `✅ ${result.number} is on WhatsApp` 
            : `❌ ${result.number} is not on WhatsApp` 
        });
      }
    });

    // Auto Reply Add Command
    this.addCommand({
      name: 'addreply',
      aliases: ['ar'],
      description: 'Add auto reply rule',
      execute: async (bot, msg, args) => {
        const [type, keyword, ...responseParts] = args;
        const response = responseParts.join(' ');
        
        if (!keyword || !response) {
          await bot.sendMessage(msg.key.remoteJid!, { 
            text: 'Usage: .addreply exact/contains/regex <keyword> <response>' 
          });
          return;
        }
        
        const id = await bot.autoReplyDB.addRule(keyword, response, type || 'exact');
        await bot.sendMessage(msg.key.remoteJid!, { text: `✅ Auto reply added! ID: ${id}` });
      }
    });

    // Scheduler Add Command
    this.addCommand({
      name: 'schedule',
      aliases: ['sched'],
      description: 'Add scheduled message',
      execute: async (bot, msg, args) => {
        const [cron, jid, ...messageParts] = args;
        const message = messageParts.join(' ');
        
        if (!cron || !jid || !message) {
          await bot.sendMessage(msg.key.remoteJid!, { 
            text: 'Usage: .schedule "* * * * *" 628xxxx@s.whatsapp.net "message"' 
          });
          return;
        }
        
        const id = bot.scheduler.addJob(cron, jid, message);
        await bot.sendMessage(msg.key.remoteJid!, { text: `✅ Scheduled! ID: ${id}` });
      }
    });

    // Backup Command
    this.addCommand({
      name: 'backup',
      aliases: ['bk'],
      description: 'Manual backup session',
      execute: async (bot, msg, args) => {
        await bot.sendMessage(msg.key.remoteJid!, { text: '⏳ Creating backup...' });
        const success = await bot.autoBackup.doBackup(bot['config'].sessionDir);
        await bot.sendMessage(msg.key.remoteJid!, { 
          text: success ? '✅ Backup completed!' : '❌ Backup failed!' 
        });
      }
    });

    // Channel Info Command
    this.addCommand({
      name: 'chinfo',
      aliases: ['channel'],
      description: 'Get channel/group info from invite',
      execute: async (bot, msg, args) => {
        const link = args[0];
        if (!link) {
          await bot.sendMessage(msg.key.remoteJid!, { text: 'Usage: .chinfo <invite link>' });
          return;
        }
        
        const info = await bot.channelChecker.fromLink(bot.getSocket(), link);
        if (info.error) {
          await bot.sendMessage(msg.key.remoteJid!, { text: `❌ ${info.message}` });
        } else {
          await bot.sendMessage(msg.key.remoteJid!, { 
            text: `📊 Channel Info:\nName: ${info.name}\nDesc: ${info.description}\nMembers: ${info.memberCount}\nID: ${info.id}` 
          });
        }
      }
    });

    // Stats Command
    this.addCommand({
      name: 'stats',
      aliases: ['status'],
      description: 'Show bot statistics',
      execute: async (bot, msg, args) => {
        const groups = await bot.getAllGroups();
        const chats = await bot.getAllChats();
        
        await bot.sendMessage(msg.key.remoteJid!, { 
          text: `📊 Bot Statistics\n\n👤 Name: ${bot.getSocket().user?.name}\n📱 ID: ${bot.getSocket().user?.id}\n👥 Groups: ${groups.length}\n💬 Chats: ${chats.length}\n⚡ Anti-Ban: ${bot['config'].antiBan.enabled ? 'ON' : 'OFF'}\n💾 Auto-Backup: ${bot['config'].autoBackup.enabled ? 'ON' : 'OFF'}` 
        });
      }
    });

    // Help Command
    this.addCommand({
      name: 'help',
      aliases: ['menu', 'commands', '?'],
      description: 'Show all commands',
      execute: async (bot, msg, args) => {
        let menu = '📋 *Available Commands*\n\n';
        for (const cmd of this.commands.values()) {
          menu += `*${bot['config'].prefix}${cmd.name}*`;
          if (cmd.aliases?.length) menu += ` (${cmd.aliases.join(', ')})`;
          menu += `\n   ↳ ${cmd.description}\n\n`;
        }
        
        await bot.sendMessage(msg.key.remoteJid!, { text: menu });
      }
    });
  }

  private addCommand(cmd: Command) {
    this.commands.set(cmd.name, cmd);
    cmd.aliases?.forEach(alias => this.commands.set(alias, cmd));
  }

  private setupListener() {
    this.bot.on('message', async (msg: proto.IWebMessageInfo) => {
      if (msg.key.fromMe) return;
      
      let text = '';
      if (msg.message?.conversation) text = msg.message.conversation;
      else if (msg.message?.extendedTextMessage) text = msg.message.extendedTextMessage.text;
      
      if (!text || !text.startsWith(this.bot['config'].prefix)) return;
      
      const args = text.slice(1).trim().split(/\s+/);
      const commandName = args.shift()?.toLowerCase();
      
      if (!commandName) return;
      
      const command = this.commands.get(commandName);
      if (command) {
        try {
          await command.execute(this.bot, msg, args);
          console.log(chalk.green(`[CMD] ${msg.key.remoteJid}: ${text}`));
        } catch (err) any) {
          console.log(chalk.red(`[CMD Error] ${err.message}`));
          await this.bot.sendMessage(msg.key.remoteJid!, { text: `❌ Error: ${err.message}` });
        }
      }
    });
  }
}
