
const express = require('express');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');

// ================= CONFIGURATION =================

const config = {
    botName: 'Aitmad MD Bot',
    prefix: '.',
    ownerNumber: process.env.OWNER_NUMBER || '',
    phoneNumber: process.env.PHONE_NUMBER || '',
    autoRead: true,
    autoReact: true,
    aiAutoReplyDefault: false,
    ai: {
        apiKey: process.env.AI_API_KEY || '',
        endpoint: process.env.AI_ENDPOINT ||
            'https://api.openai.com/v1/chat/completions',
        model: process.env.AI_MODEL || 'gpt-4o-mini'
    }
};

const PORT = process.env.PORT || 3000;
const SESSION_DIR = process.env.SESSION_DIR || '/data/auth_info_main';

let aiAutoReply = config.aiAutoReplyDefault;
let sock = null;
let reconnecting = false;
let pairingRequested = false;

const app = express();

app.get('/', (req, res) => {
    res.status(200).send('Aitmad MD Bot is running!');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        connected: Boolean(sock?.user),
        bot: config.botName
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP server running on port ${PORT}`);
});

// ================= UTILITIES =================

function normalizeNumber(number) {
    return String(number || '').replace(/\D/g, '');
}

function isOwner(msg) {
    if (msg.key?.fromMe) return true;

    const sender = (
        msg.key?.participant ||
        msg.key?.remoteJid ||
        ''
    ).split('@')[0].split(':')[0];

    const owner = normalizeNumber(config.ownerNumber);

    return Boolean(owner && sender === owner);
}

async function sendText(jid, text, msg) {
    return sock.sendMessage(
        jid,
        { text },
        msg ? { quoted: msg } : {}
    );
}

// ================= AI SYSTEM =================

async function askAI(prompt) {
    if (!config.ai.apiKey) {
        return 'AI service is not configured.';
    }

    try {
        const response = await fetch(config.ai.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.ai.apiKey}`
            },
            body: JSON.stringify({
                model: config.ai.model,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            }),
            signal: AbortSignal.timeout(25000)
        });

        if (!response.ok) {
            throw new Error(`AI HTTP ${response.status}`);
        }

        const data = await response.json();

        return data?.choices?.[0]?.message?.content?.trim()
            || 'AI could not generate a response.';

    } catch (error) {
        console.error('AI error:', error.message);
        return 'AI service is temporarily unavailable.';
    }
}

// ================= COMMAND HANDLER =================

async function handleCommand(msg, text) {
    const jid = msg.key.remoteJid;

    const parts = text.slice(config.prefix.length)
        .trim()
        .split(/\s+/);

    const command = (parts.shift() || '').toLowerCase();
    const args = parts.join(' ');

    switch (command) {

        case 'menu':
            return sendText(jid,
`╭━━━〔 ${config.botName} 〕━━━╮

🤖 AI COMMANDS
.ai <question>
.ai on
.ai off
.ai status

⚙️ SYSTEM
.menu
.ping
.autoread on/off
.autoreact on/off

╰━━━━━━━━━━━━━━━━━━╯`, msg);

        case 'ping':
            return sendText(jid, '🏓 Aitmad Bot is online!', msg);

        case 'ai':
            if (args.toLowerCase() === 'on') {
                if (!isOwner(msg)) {
                    return sendText(jid, 'Owner permission required.', msg);
                }

                aiAutoReply = true;
                return sendText(jid, '✅ AI Auto Reply ON', msg);
            }

            if (args.toLowerCase() === 'off') {
                if (!isOwner(msg)) {
                    return sendText(jid, 'Owner permission required.', msg);
                }

                aiAutoReply = false;
                return sendText(jid, '❌ AI Auto Reply OFF', msg);
            }

            if (args.toLowerCase() === 'status') {
                return sendText(
                    jid,
                    `AI Auto Reply: ${aiAutoReply ? 'ON' : 'OFF'}`,
                    msg
                );
            }

            if (!args) {
                return sendText(jid, 'Example: .ai Hello', msg);
            }

            return sendText(jid, await askAI(args), msg);

        case 'autoread':
            if (!isOwner(msg)) {
                return sendText(jid, 'Owner permission required.', msg);
            }

            config.autoRead = args.toLowerCase() === 'on';
            return sendText(
                jid,
                `Auto Read: ${config.autoRead ? 'ON' : 'OFF'}`,
                msg
            );

        case 'autoreact':
            if (!isOwner(msg)) {
                return sendText(jid, 'Owner permission required.', msg);
            }

            config.autoReact = args.toLowerCase() === 'on';
            return sendText(
                jid,
                `Auto React: ${config.autoReact ? 'ON' : 'OFF'}`,
                msg
            );

        default:
            return null;
    }
}

// ================= WHATSAPP CONNECTION =================

async function startBot() {
    if (reconnecting) return;
    reconnecting = true;

    try {
        fs.mkdirSync(SESSION_DIR, { recursive: true });

        const { state, saveCreds } =
            await useMultiFileAuthState(SESSION_DIR);

        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: Browsers.macOS('Desktop'),
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (
                connection === 'connecting' &&
                !state.creds.registered &&
                !pairingRequested
            ) {
                pairingRequested = true;

                const number = normalizeNumber(config.phoneNumber);

                if (!number) {
                    console.error(
                        'Set PHONE_NUMBER in Railway Variables.'
                    );
                    return;
                }

                try {
                    await new Promise(resolve =>
                        setTimeout(resolve, 2000)
                    );

                    const code = await sock.requestPairingCode(number);

                    console.log('==============================');
                    console.log('AITMAD WHATSAPP PAIRING CODE');
                    console.log('Number:', number);
                    console.log('Code:', code);
                    console.log('==============================');

                } catch (error) {
                    pairingRequested = false;
                    console.error(
                        'Pairing failed:',
                        error.message
                    );
                }
            }

            if (connection === 'open') {
                console.log('✅ WhatsApp Connected!');
                console.log('Bot:', config.botName);
                reconnecting = false;
            }

            if (connection === 'close') {
                const status =
                    lastDisconnect?.error?.output?.statusCode;

                reconnecting = false;
                pairingRequested = false;

                if (status === DisconnectReason.loggedOut) {
                    console.error(
                        'WhatsApp logged out. Re-linking is required.'
                    );
                    return;
                }

                console.log('Connection closed. Reconnecting...');

                setTimeout(startBot, 5000);
            }
        });

        // ================= MESSAGE HANDLER =================

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                if (!msg.message) continue;
                if (msg.key.fromMe) continue;

                const jid = msg.key.remoteJid;

                if (!jid || jid === 'status@broadcast') continue;

                const content = msg.message;

                const text =
                    content.conversation ||
                    content.extendedTextMessage?.text ||
                    content.imageMessage?.caption ||
                    content.videoMessage?.caption ||
                    '';

                const cleanText = text.trim();

                if (!cleanText) continue;

                try {
                    if (config.autoRead) {
                        await sock.readMessages([msg.key]);
                    }

                    if (config.autoReact) {
                        await sock.sendMessage(jid, {
                            react: {
                                text: '❤️',
                                key: msg.key
                            }
                        }).catch(() => {});
                    }

                    if (cleanText.startsWith(config.prefix)) {
                        await handleCommand(msg, cleanText);
                        continue;
                    }

                    if (
                        aiAutoReply &&
                        (!jid.endsWith('@g.us'))
                    ) {
                        const answer = await askAI(cleanText);

                        await sock.sendMessage(jid, {
                            text: answer
                        }, {
                            quoted: msg
                        });
                    }

                } catch (error) {
                    console.error(
                        'Message handler error:',
                        error.message
                    );
                }
            }
        });

    } catch (error) {
        reconnecting = false;
        console.error('Startup error:', error);

        setTimeout(startBot, 10000);
    }
}

// ================= START =================

startBot().catch(error => {
    console.error('Fatal startup error:', error);
    process.exit(1);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled rejection:', error);
});
