const puppeteer = require('puppeteer');
const imap = require('imap-simple');
const { simpleParser } = require('mailparser');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

// Configuration from Render Environment Variables
const CONFIG = {
    email: process.env.SARVINARCK_EMAIL,
    password: process.env.SARVINARCK_PASSWORD,
    gmailUser: process.env.GMAIL_USER,
    gmailPass: process.env.GMAIL_APP_PASSWORD, 
    supabaseUrl: process.env.SUPABASE_FUNCTION_URL
};

/**
 * Connects to Gmail and searches for the 6-digit 2FA code with SSL fix
 */
async function getLatestCode() {
    const imapConfig = {
        imap: {
            user: CONFIG.gmailUser,
            password: CONFIG.gmailPass,
            host: 'imap.gmail.com',
            port: 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false }, // FIX: Bypasses self-signed cert error on Render
            authTimeout: 15000
        }
    };

    console.log("📧 Connecting to Gmail...");
    try {
        const connection = await imap.connect(imapConfig);
        await connection.openBox('[Gmail]/All Mail'); 

        const delay = 5 * 60 * 1000; 
        const searchCriteria = [['SINCE', new Date(Date.now() - delay).toISOString()]];
        const fetchOptions = { bodies: ['HEADER', 'TEXT'], markSeen: false };

        console.log("🔎 Scanning for recent 2FA emails...");

        for (let i = 0; i < 12; i++) {
            const messages = await connection.search(searchCriteria, fetchOptions);
            
            if (messages.length > 0) {
                const recentMessages = messages.slice(-3).reverse(); 
                
                for (let item of recentMessages) {
                    const all = item.parts.find(part => part.which === 'TEXT');
                    const id = item.attributes.uid;
                    const idHeader = "Imap-Id: "+id+"\r\n";
                    const parsed = await simpleParser(idHeader + all.body);

                    // Robust parsing to avoid TypeError on 'text'
                    const fromEmail = parsed.from?.text || "Unknown Sender";
                    const subjectLine = parsed.subject || "No Subject";

                    console.log(`📩 Checking: ${fromEmail} | Sub: ${subjectLine}`);

                    const codeMatch = parsed.text?.match(/\b\d{6}\b/);

                    if (codeMatch) {
                        console.log(`✅ FOUND CODE: ${codeMatch[0]}`);
                        connection.end();
                        return codeMatch[0];
                    }
                }
            }
            console.log(`... attempt ${i+1}/12 (waiting 5s)`);
            await new Promise(r => setTimeout(r, 5000));
        }
        
        connection.end();
        return null;
    } catch (err) {
        console.error("❌ Gmail IMAP Error:", err);
        return null;
    }
}

/**
 * Main automation function
 */
async function runBot() {
    console.log("🤖 Bot starting...");
    const browser = await puppeteer.launch({
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', // Critical for Render stability
            '--disable-gpu'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        headless: 'new'
    });

    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(90000); 
        page.setDefaultTimeout(90000);

        let capturedToken = null;

        // Intercept network response for the token
        page.on('response', async (res) => {
            if (res.url().includes('oauth2/token')) {
                try {
                    const data = await res.json();
                    if (data.access_token) {
                        console.log("🔥 ACCESS TOKEN INTERCEPTED!");
                        capturedToken = data.access_token;
                    }
                } catch (e) {}
            }
        });

        console.log("🔵 Navigating to Sarvinarck Sign-in...");
        await page.goto('https://app.sarvinarck.com/sign-in', { waitUntil: 'domcontentloaded' });

        // Step 1: Login
        console.log("⌨️ Typing credentials...");
        await page.waitForSelector('input[name="loginId"], input[type="text"]', { visible: true });
        await page.type('input[name="loginId"]', CONFIG.email, { delay: 50 }); 
        await page.waitForSelector('input[name="password"]', { visible: true });
        await page.type('input[name="password"]', CONFIG.password, { delay: 50 });
        await page.keyboard.press('Enter');

        // Step 2: 2FA Screen
        console.log("⏳ Waiting for 2FA screen...");
        await page.waitForSelector('input[name="code"]', { visible: true, timeout: 45000 });

        // Step 3: Get Code from Gmail
        const code = await getLatestCode();
        if (!code) throw new Error("Could not retrieve 2FA code.");

        // Step 4: Submit Code
        await page.type('input[name="code"]', code, { delay: 100 });
        await page.keyboard.press('Enter');

        // Step 5: Active Polling for Token
        console.log("⏳ Code submitted. Polling for token capture (up to 30s)...");
        let maxWait = 30; 
        while (!capturedToken && maxWait > 0) {
            await new Promise(r => setTimeout(r, 1000));
            maxWait--;
            if (maxWait % 5 === 0) console.log(`... waiting for network response (${maxWait}s left)`);
        }

        if (capturedToken) {
            console.log("🚀 Syncing token with Supabase...");
            await axios.post(CONFIG.supabaseUrl, { access_token: capturedToken });
            return "Success: Token Updated";
        } else {
            throw new Error("No token captured after 2FA submission.");
        }

    } catch (error) {
        console.error("❌ Automation Failure:", error.message);
        return "Error: " + error.message;
    } finally {
        await browser.close();
        console.log("🤖 Bot shutting down.");
    }
}

app.get('/refresh', async (req, res) => {
    const result = await runBot();
    res.send({ status: result });
});

app.get('/', (req, res) => res.send("Bot Active. Use /refresh"));

app.listen(PORT, () => console.log(`🚀 Listening on port ${PORT}`));
