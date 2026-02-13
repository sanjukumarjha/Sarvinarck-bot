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

    try {
        const connection = await imap.connect(imapConfig);
        await connection.openBox('[Gmail]/All Mail');

        const delay = 5 * 60 * 1000;
        const searchCriteria = [['SINCE', new Date(Date.now() - delay)]];
        const fetchOptions = { bodies: ['TEXT'], markSeen: false };

        for (let i = 0; i < 12; i++) {
            const messages = await connection.search(searchCriteria, fetchOptions);

            if (messages.length > 0) {
                const recentMessages = messages.slice(-3).reverse();

                for (let item of recentMessages) {
                    const all = item.parts.find(part => part.which === 'TEXT');
                    const parsed = await simpleParser(all.body);

                    const codeMatch = parsed.text?.match(/\b\d{6}\b/);
                    if (codeMatch) {
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
        console.error("Gmail Error:", err.message);
        return null;
    }
}

async function runBot() {
    console.log("🤖 Core Bot Logic Started");
    let browser;

    try {
        browser = await puppeteer.launch({
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--renderer-process-limit=1',
                '--disable-extensions'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            headless: 'new'
        });

        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(90000);
        page.setDefaultTimeout(90000);

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto('https://app.sarvinarck.com/sign-in', { waitUntil: 'domcontentloaded' });

        await page.waitForSelector('input[name="loginId"]', { visible: true });
        await page.type('input[name="loginId"]', CONFIG.email, { delay: 30 });

        await page.waitForSelector('input[name="password"]', { visible: true });
        await page.type('input[name="password"]', CONFIG.password, { delay: 30 });

        await page.keyboard.press('Enter');

        await page.waitForSelector('input[name="code"]', { visible: true, timeout: 45000 });

        const code = await getLatestCode();
        if (!code) throw new Error("2FA code not found");

        await page.type('input[name="code"]', code, { delay: 80 });
        await page.keyboard.press('Enter');

        await page.waitForFunction(
            () => !window.location.href.includes('sign-in'),
            { timeout: 60000 }
        );

        let foundToken = null;
        for (let i = 0; i < 15; i++) {
            const cookies = await page.cookies();
            const tokenCookie = cookies.find(c => c.name === 'apiToken');

            if (tokenCookie) {
                foundToken = tokenCookie.value;
                break;
            }
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!foundToken) throw new Error("apiToken not found in cookies");

        await axios.post(
            CONFIG.supabaseUrl,
            { access_token: foundToken },
            { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
        );

        console.log("✅ Token synced successfully");

    } catch (err) {
        console.error("❌ Core Bot Error:", err.message);
    } finally {
        if (browser) await browser.close();
        console.log("🤖 Core Bot finished");
    }
}

module.exports = { runBot };
