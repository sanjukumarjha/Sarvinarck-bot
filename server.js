const puppeteer = require('puppeteer');
const imap = require('imap-simple');
const { simpleParser } = require('mailparser');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

const CONFIG = {
    email: process.env.SARVINARCK_EMAIL,
    password: process.env.SARVINARCK_PASSWORD,
    gmailUser: process.env.GMAIL_USER,
    gmailPass: process.env.GMAIL_APP_PASSWORD, 
    supabaseUrl: process.env.SUPABASE_FUNCTION_URL
};

async function getLatestCode() {
    const imapConfig = {
        imap: {
            user: CONFIG.gmailUser,
            password: CONFIG.gmailPass,
            host: 'imap.gmail.com',
            port: 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false }, 
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
                    
                    const codeMatch = parsed.text?.match(/\b\d{6}\b/);
                    if (codeMatch) {
                        console.log(`✅ FOUND CODE: ${codeMatch[0]}`);
                        connection.end();
                        return codeMatch[0];
                    }
                }
            }
            await new Promise(r => setTimeout(r, 5000));
        }
        connection.end();
        return null;
    } catch (err) {
        console.error("❌ Gmail IMAP Error:", err);
        return null;
    }
}

async function runBot() {
    console.log("🤖 Bot starting...");
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        headless: 'new'
    });

    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(90000); 
        page.setDefaultTimeout(90000);

        console.log("🔵 Navigating to Sarvinarck Sign-in...");
        await page.goto('https://app.sarvinarck.com/sign-in', { waitUntil: 'domcontentloaded' });

        // Login Flow
        await page.waitForSelector('input[name="loginId"]', { visible: true });
        await page.type('input[name="loginId"]', CONFIG.email, { delay: 50 }); 
        await page.waitForSelector('input[name="password"]', { visible: true });
        await page.type('input[name="password"]', CONFIG.password, { delay: 50 });
        await page.keyboard.press('Enter');

        // 2FA Flow
        console.log("⏳ Waiting for 2FA screen...");
        await page.waitForSelector('input[name="code"]', { visible: true, timeout: 45000 });
        const code = await getLatestCode();
        if (!code) throw new Error("Could not retrieve 2FA code.");
        await page.type('input[name="code"]', code, { delay: 100 });
        await page.keyboard.press('Enter');

        // 🟢 WAIT FOR DASHBOARD COOKIES
        // This is the new part that replaces the "Polling" logic
        console.log("⏳ Login submitted. Waiting for dashboard to load...");
        
        // Wait until we are NO LONGER on the sign-in page
        await page.waitForFunction(() => !window.location.href.includes('sign-in'), { timeout: 60000 });
        
        console.log("⏳ Dashboard loaded. Giving cookies 5s to set...");
        await new Promise(r => setTimeout(r, 5000));

        // 🟢 EXTRACT COOKIES
        const cookies = await page.cookies();
        console.log(`🍪 Found ${cookies.length} cookies.`);

        // Find the 'apiToken' cookie (case-insensitive search)
        const targetCookie = cookies.find(c => c.name.toLowerCase().includes('apitoken'));

        if (targetCookie) {
            console.log("🔥 FOUND 'apiToken' COOKIE:", targetCookie.value.substring(0, 15) + "...");
            
            console.log("🚀 Syncing token with Supabase...");
            await axios.post(CONFIG.supabaseUrl, 
                { access_token: targetCookie.value }, 
                { headers: { 'Content-Type': 'application/json' } }
            );
            return "Success: Cookie Token Updated";
        } else {
            // Log what we found to help debug
            const cookieNames = cookies.map(c => c.name).join(', ');
            console.log("❌ 'apiToken' not found. Cookies present: ", cookieNames);
            throw new Error("Target cookie not found.");
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
