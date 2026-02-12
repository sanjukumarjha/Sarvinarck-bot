const puppeteer = require('puppeteer');
const imap = require('imap-simple');
const { simpleParser } = require('mailparser');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// 🟢 Load secrets from Render Environment Variables
const CONFIG = {
    email: process.env.SARVINARCK_EMAIL,
    password: process.env.SARVINARCK_PASSWORD,
    gmailUser: process.env.GMAIL_USER,
    gmailPass: process.env.GMAIL_APP_PASSWORD, // jmeo xsnk yixn oxkp
    supabaseUrl: process.env.SUPABASE_FUNCTION_URL
};

// Helper: Check Gmail for the latest code
async function getLatestCode() {
    const imapConfig = {
        imap: {
            user: CONFIG.gmailUser,
            password: CONFIG.gmailPass,
            host: 'imap.gmail.com',
            port: 993,
            tls: true,
            authTimeout: 10000
        }
    };

    console.log("📧 Connecting to Gmail...");
    try {
        const connection = await imap.connect(imapConfig);
        await connection.openBox('INBOX');

        // Look for emails from the last 5 minutes
        const delay = 5 * 60 * 1000; 
        const searchCriteria = [['SINCE', new Date(Date.now() - delay).toISOString()]];
        const fetchOptions = { bodies: ['HEADER', 'TEXT'], markSeen: false };

        // Retry loop: Scan inbox every 5 seconds for 1 minute
        for (let i = 0; i < 12; i++) {
            console.log(`🔎 Scanning Inbox (Attempt ${i+1})...`);
            const messages = await connection.search(searchCriteria, fetchOptions);
            
            if (messages.length > 0) {
                // Get the very last email received
                const item = messages[messages.length - 1];
                const all = item.parts.find(part => part.which === 'TEXT');
                const id = item.attributes.uid;
                const idHeader = "Imap-Id: "+id+"\r\n";
                const parsed = await simpleParser(idHeader + all.body);

                // Regex to find a 6-digit code
                const codeMatch = parsed.text.match(/\b\d{6}\b/);
                
                // Safety check: Ensure it's likely from Sarvinarck
                if (codeMatch && (parsed.subject.includes('Sarvinarck') || parsed.text.includes('verification'))) {
                    console.log(`✅ FOUND CODE: ${codeMatch[0]}`);
                    connection.end();
                    return codeMatch[0];
                }
            }
            await new Promise(r => setTimeout(r, 5000)); // Wait 5s
        }
        
        connection.end();
        console.log("❌ No code found after 60 seconds.");
        return null;
    } catch (err) {
        console.error("❌ Gmail Error:", err);
        return null;
    }
}

async function runBot() {
    console.log("🤖 Bot starting...");
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        headless: 'new'
    });

    try {
        const page = await browser.newPage();
        
        // 1. Listen for the token network request
        let capturedToken = null;
        page.on('response', async (res) => {
            if (res.url().includes('oauth2/token')) {
                try {
                    const data = await res.json();
                    if (data.access_token) {
                        console.log("🔥 ACCESS TOKEN CAPTURED!");
                        capturedToken = data.access_token;
                    }
                } catch (e) {}
            }
        });

        // 2. Log In
        await page.goto('https://app.sarvinarck.com/sign-in', { waitUntil: 'networkidle2' });
        
        // Type credentials (Update selectors if they change!)
        await page.type('input[type="text"]', CONFIG.email); 
        await page.type('input[type="password"]', CONFIG.password);
        await page.keyboard.press('Enter');

        console.log("⏳ Credentials entered. Waiting for 2FA input...");
        
        // 3. Wait for 2FA Screen
        try {
            await page.waitForSelector('input[name="code"]', { timeout: 15000 });
        } catch(e) {
            console.log("⚠️ 2FA Input not found. Maybe we are already logged in?");
        }

        // 4. Get Code from Gmail
        const code = await getLatestCode();
        if (!code) throw new Error("Could not get 2FA code.");

        // 5. Enter Code
        await page.type('input[name="code"]', code);
        await page.keyboard.press('Enter');

        // 6. Wait for dashboard and token capture
        console.log("⏳ Verifying...");
        await page.waitForTimeout(8000); 

        if (capturedToken) {
            console.log("🚀 Sending token to Supabase...");
            // Send to your Supabase function
            await axios.post(CONFIG.supabaseUrl, { access_token: capturedToken });
            return "Success: Token Updated";
        } else {
            throw new Error("Login worked, but token was not captured.");
        }

    } catch (error) {
        console.error("❌ Failed:", error.message);
        return "Error: " + error.message;
    } finally {
        await browser.close();
    }
}

// Endpoint to trigger the bot
app.get('/refresh', async (req, res) => {
    const result = await runBot();
    res.send({ status: result });
});

app.listen(PORT, () => console.log(`Listening on port ${PORT}`));