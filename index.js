const express = require('express');
const path = require('path');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname)); // index.html ko serve karne ke liye

// Main page route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Pairing Code API Endpoint
app.get('/pair', async (req, res) => {
    let num = req.query.number;
    if (!num) {
        return res.status(400).json({ error: 'Phone number zaroori hai' });
    }

    // Number se extra symbols (+) ya spaces hatana
    num = num.replace(/[^0-9]/g, '');

    try {
        const { state, saveCreds } = await useMultiFileAuthState('./session');

        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        sock.ev.on('creds.update', saveCreds);

        // Agar pehle se registered nahi hai to pairing code generate karein
        if (!sock.authState.creds.registered) {
            await delay(1500);
            const code = await sock.requestPairingCode(num);
            return res.json({ code: code });
        } else {
            return res.json({ message: 'WhatsApp pehle se connected hai!' });
        }

    } catch (error) {
        console.error('Pairing Error:', error);
        return res.status(500).json({ error: 'Code generate karne mein masla aaya. Dobara koshish karein.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server chal raha hai: http://localhost:${PORT}`);
});
