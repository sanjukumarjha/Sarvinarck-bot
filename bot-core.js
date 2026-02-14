process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const puppeteer = require('puppeteer');
const imap = require('imap-simple');
const { simpleParser } = require('mailparser');
const axios = require('axios');

const CONFIG = {
    email: process.env.SARVINARCK_EMAIL,
    password: process.env.SARVINARCK_PASSWORD,
    gmailUser: process.env.GMAIL_USER,
    gmailPass: process.env.GMAIL_APP_PASSWORD,
    supabaseUrl: process.env.SUPABASE_FUNCTION_URL
};

/* ---------------------------------------------------
   GET LATEST 2FA CODE FROM GMAIL
--------------------------------------------------- */
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

    try {
        const connection = await imap.connect(imapConfig);
        await connection.openBox('INBOX');

        const delay = 3 * 60 * 1000;
        const searchCriteria = [['SINCE', new Date(Date.now() - delay)]];
        const fetchOptions = { bodies: ['TEXT'], markSeen: false };

        for (let i = 0; i < 6; i++) {
            const messages = await connection.search(searchCriteria, fetchOptions);

            if (messages.length > 0) {
                const recentMessages = messages.slice(-3).reverse();

                for (let item of recentMessages) {
                    const all = item.parts.find(part => part.which === 'TEXT');
                    const parsed = await simpleParser(all.body);

                    const codeMatch = parsed.text?.match(/\b\d{6}\b/);
                    if (codeMatch) {
                        await connection.end();
                        console.log("✅ 2FA Code Found");
                        return codeMatch[0];
                    }
                }
            }

            await new Promise(r => setTimeout(r, 5000));
        }

        await connection.end();
        return null;

    } catch (err) {
        console.error("❌ Gmail Error:", err.message);
        return null;
    }
}

/* ---------------------------------------------------
   MAIN BOT LOGIC
--------------------------------------------------- */
async function runBot() {
    console.log("🤖 Core Bot Started");

    let browser;

    try {
        browser = await puppeteer.launch({
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process'
            ],
            headless: true
        });

        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(60000);

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto('https://app.sarvinarck.com/sign-in', {
            waitUntil: 'domcontentloaded'
        });

        await page.waitForSelector('input[name="loginId"]', { visible: true });
        await page.type('input[name="loginId"]', CONFIG.email, { delay: 20 });

        await page.waitForSelector('input[name="password"]', { visible: true });
        await page.type('input[name="password"]', CONFIG.password, { delay: 20 });

        await page.keyboard.press('Enter');

        await page.waitForSelector('input[name="code"]', {
            visible: true,
            timeout: 45000
        });

        const code = await getLatestCode();
        if (!code) throw new Error("2FA code not found");

        await page.type('input[name="code"]', code, { delay: 50 });
        await page.keyboard.press('Enter');

        await page.waitForFunction(
            () => !window.location.href.includes('sign-in'),
            { timeout: 60000 }
        );

        let foundToken = null;

        for (let i = 0; i < 10; i++) {
            const cookies = await page.cookies();
            const tokenCookie = cookies.find(c => c.name === 'apiToken');

            if (tokenCookie) {
                foundToken = tokenCookie.value;
                break;
            }

            await new Promise(r => setTimeout(r, 2000));
        }

        if (!foundToken) throw new Error("apiToken not found");

        await axios.post(
            CONFIG.supabaseUrl,
            { access_token: foundToken },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            }
        );

        console.log("✅ Token synced successfully");

    } catch (err) {
        console.error("❌ Core Bot Error:", err.message);
    } finally {
        if (browser) {
            await browser.close();
        }
        console.log("🤖 Core Bot Finished");
    }
}

module.exports = { runBot };
