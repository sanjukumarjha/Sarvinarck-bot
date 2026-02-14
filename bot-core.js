const puppeteer = require('puppeteer');
const imap = require('imap-simple');
const { simpleParser } = require('mailparser');
const axios = require('axios');

/* ===================================================
   CONFIG (From GitHub Secrets)
=================================================== */
const CONFIG = {
  email: process.env.SARVINARCK_EMAIL,
  password: process.env.SARVINARCK_PASSWORD,
  gmailUser: process.env.GMAIL_USER,
  gmailPass: process.env.GMAIL_APP_PASSWORD,
  supabaseUrl: process.env.SUPABASE_FUNCTION_URL
};

/* ===================================================
   GET LATEST 2FA CODE FROM GMAIL
=================================================== */
async function getLatestCode() {
  const imapConfig = {
    imap: {
      user: CONFIG.gmailUser,
      password: CONFIG.gmailPass,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      authTimeout: 15000
    }
  };

  try {
    console.log("📧 Connecting to Gmail...");

    const connection = await imap.connect(imapConfig);
    await connection.openBox('INBOX');

    const delayWindow = 5 * 60 * 1000; // last 5 minutes
    const searchCriteria = [
      ['SINCE', new Date(Date.now() - delayWindow)]
    ];

    const fetchOptions = {
      bodies: ['TEXT'],
      markSeen: false
    };

    for (let attempt = 0; attempt < 6; attempt++) {
      console.log(`🔎 Checking for 2FA email (Attempt ${attempt + 1}/6)...`);

      const messages = await connection.search(searchCriteria, fetchOptions);

      if (messages.length > 0) {
        const recentMessages = messages.slice(-5).reverse();

        for (let item of recentMessages) {
          const bodyPart = item.parts.find(p => p.which === 'TEXT');
          const parsed = await simpleParser(bodyPart.body);

          const codeMatch = parsed.text?.match(/\b\d{6}\b/);
          if (codeMatch) {
            console.log("✅ 2FA Code Found:", codeMatch[0]);
            await connection.end();
            return codeMatch[0];
          }
        }
      }

      await new Promise(r => setTimeout(r, 5000));
    }

    await connection.end();
    console.log("❌ No 2FA code found.");
    return null;

  } catch (err) {
    console.error("❌ Gmail Error:", err.message);
    return null;
  }
}

/* ===================================================
   MAIN BOT LOGIC
=================================================== */
async function runBot() {
  console.log("🤖 Core Bot Started");

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote'
      ]
    });

    const page = await browser.newPage();

    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    // Speed optimization
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const blockedTypes = ['image', 'stylesheet', 'font', 'media'];
      if (blockedTypes.includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log("🌐 Opening Sarvinarck login page...");
    await page.goto('https://app.sarvinarck.com/sign-in', {
      waitUntil: 'domcontentloaded'
    });

    console.log("🔐 Entering login credentials...");

    await page.waitForSelector('input[name="loginId"]', { visible: true });
    await page.type('input[name="loginId"]', CONFIG.email, { delay: 30 });

    await page.waitForSelector('input[name="password"]', { visible: true });
    await page.type('input[name="password"]', CONFIG.password, { delay: 30 });

    await page.keyboard.press('Enter');

    console.log("⏳ Waiting for 2FA input...");

    await page.waitForSelector('input[name="code"]', {
      visible: true,
      timeout: 45000
    });

    const code = await getLatestCode();
    if (!code) throw new Error("2FA code not found");

    console.log("🔑 Entering 2FA code...");
    await page.type('input[name="code"]', code, { delay: 50 });
    await page.keyboard.press('Enter');

    console.log("⏳ Waiting for successful login...");

    await page.waitForFunction(
      () => !window.location.href.includes('sign-in'),
      { timeout: 60000 }
    );

    console.log("🍪 Extracting apiToken cookie...");

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

    console.log("🚀 Sending token to Supabase...");

    await axios.post(
      CONFIG.supabaseUrl,
      { access_token: foundToken },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 20000
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

/* ===================================================
   RUN DIRECTLY
=================================================== */
if (require.main === module) {
  runBot();
}

module.exports = { runBot };
