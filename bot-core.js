const puppeteer = require("puppeteer");
const axios = require("axios");
const { google } = require("googleapis");

const CONFIG = {
  email: process.env.SARVINARCK_EMAIL,
  password: process.env.SARVINARCK_PASSWORD,
  supabaseUrl: process.env.SUPABASE_FUNCTION_URL,
  gmailUser: process.env.GMAIL_USER,
  gmailClientId: process.env.GMAIL_CLIENT_ID,
  gmailClientSecret: process.env.GMAIL_CLIENT_SECRET,
  gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN,
};

// Global start time to ensure we only pick up NEW emails
const SCRIPT_START_TIME = Date.now();

/* ---------------------------------------------------
   GET 2FA CODE (ROBUST POLLING)
--------------------------------------------------- */
/* ---------------------------------------------------
   GET 2FA CODE (DIRECT INBOX CHECK - NO SEARCH)
--------------------------------------------------- */
async function getLatestCode() {
  console.log("📩 Initializing Gmail Client...");

  const oAuth2Client = new google.auth.OAuth2(
    CONFIG.gmailClientId,
    CONFIG.gmailClientSecret
  );

  oAuth2Client.setCredentials({
    refresh_token: CONFIG.gmailRefreshToken,
  });

  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  // POLL: Check every 5 seconds for up to 90 seconds
  const maxRetries = 18; 
  
  for (let i = 0; i < maxRetries; i++) {
    console.log(`⏳ [Attempt ${i + 1}/${maxRetries}] Scanning Inbox for Sarvinarck email...`);
    
    try {
      // 1. FETCH RAW INBOX (No 'q' filter to avoid indexing lag or typo issues)
      const res = await gmail.users.messages.list({
        userId: "me",
        maxResults: 10, // Grab the last 10 emails received
      });

      if (res.data.messages && res.data.messages.length > 0) {
        
        // 2. Loop through recent emails to find the one from Sarvinarck
        for (const msg of res.data.messages) {
          const message = await gmail.users.messages.get({
            userId: "me",
            id: msg.id,
          });

          // Extract Headers to check Sender/Subject
          const headers = message.data.payload.headers;
          const fromHeader = headers.find(h => h.name === 'From')?.value || '';
          const subjectHeader = headers.find(h => h.name === 'Subject')?.value || '';
          const internalDate = parseInt(message.data.internalDate, 10);

          // DEBUG: Print what we see (helps you debug if it fails again)
          // console.log(`   🔎 Scanned email from: ${fromHeader} | Subject: ${subjectHeader}`);

          // 3. CHECK IF THIS IS THE RIGHT EMAIL
          // We check if "Sarvinarck" is in the Sender OR Subject
          if (fromHeader.includes("Sarvinarck") || subjectHeader.includes("Sarvinarck")) {
            
            // 4. Time Check: Is it recent? (within last 2 minutes)
            if (internalDate > (Date.now() - 120000)) {
                console.log(`✅ Found Target Email: "${subjectHeader}"`);

                const body = Buffer.from(
                    message.data.payload.parts
                      ? message.data.payload.parts[0].body.data
                      : message.data.payload.body.data,
                    "base64"
                ).toString("utf-8");

                const match = body.match(/\b\d{6}\b/);
                if (match) {
                    console.log("🎉 2FA Code Extracted:", match[0]);
                    return match[0];
                } else {
                    console.log("⚠️ Found Sarvinarck email, but could not regex match 6 digits.");
                }
            }
          }
        }
        console.log("❌ Sarvinarck email not found in last 10 messages.");
      } else {
        console.log("❌ Inbox is empty or inaccessible.");
      }

    } catch (err) {
      console.error("⚠️ Gmail API Error:", err.message);
    }

    // Wait 5 seconds before next try
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.error("❌ Timeout: OTP email never arrived.");
  return null;
}
/* ---------------------------------------------------
   MAIN BOT
--------------------------------------------------- */
async function runBot() {
  console.log("🤖 Core Bot Started");
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage" // Added for stability in containers
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115 Safari/537.36"
    );

    // Increase timeouts
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    console.log("🌐 Opening Sarvinarck login...");
    await page.goto("https://app.sarvinarck.com/sign-in", {
      waitUntil: "networkidle2",
    });

    // Hydration wait
    await new Promise((r) => setTimeout(r, 5000));

    const emailSelector = 'input[name="loginId"], input[type="email"]';
    const passwordSelector = 'input[name="password"], input[type="password"]';

    console.log("🔍 Waiting for login fields...");
    await page.waitForSelector(emailSelector);

    await page.type(emailSelector, CONFIG.email, { delay: 50 });
    await page.type(passwordSelector, CONFIG.password, { delay: 50 });
    await page.keyboard.press("Enter");

    console.log("⏳ Waiting for 2FA input field to appear...");
    // Wait for the UI to actually ask for the code BEFORE we start polling Gmail
    await page.waitForSelector('input[name="code"], input[type="text"]');

    // Start polling Gmail NOW
    const code = await getLatestCode();

    if (!code) throw new Error("2FA code retrieval failed");

    await page.type('input[name="code"], input[type="text"]', code, {
      delay: 80,
    });
    await page.keyboard.press("Enter");

    console.log("⏳ verifying login success...");
    await page.waitForFunction(
      () => !window.location.href.includes("sign-in"),
      { timeout: 60000 }
    );

    console.log("🔎 Searching for apiToken cookie...");
    let foundToken = null;

    for (let i = 0; i < 15; i++) {
      const cookies = await page.cookies();
      const tokenCookie = cookies.find((c) => c.name === "apiToken");

      if (tokenCookie) {
        foundToken = tokenCookie.value;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!foundToken) throw new Error("apiToken not found");

    console.log("📤 Sending token to Supabase...");
    await axios.post(
      CONFIG.supabaseUrl,
      { access_token: foundToken },
      { timeout: 15000 }
    );

    console.log("✅ Token synced successfully");
  } catch (err) {
    console.error("❌ Core Bot Error:", err.message);
    throw err;
  } finally {
    if (browser) await browser.close();
    console.log("🤖 Core Bot Finished");
  }
}

module.exports = { runBot };
