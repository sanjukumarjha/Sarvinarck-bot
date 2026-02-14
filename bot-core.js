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

/* ---------------------------------------------------
   GET 2FA CODE USING GMAIL API + REFRESH TOKEN
--------------------------------------------------- */
async function getLatestCode() {
  console.log("📩 Checking Gmail for 2FA code...");

  const oAuth2Client = new google.auth.OAuth2(
    CONFIG.gmailClientId,
    CONFIG.gmailClientSecret
  );

  oAuth2Client.setCredentials({
    refresh_token: CONFIG.gmailRefreshToken,
  });

  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  // wait for OTP email to arrive
  console.log("⏳ Waiting 20 seconds for OTP email...");
  await new Promise((r) => setTimeout(r, 20000));

  try {
    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: 5,
      q: "from:no-reply@sarvinarck.com newer_than:5m",
    });

    if (!res.data.messages) {
      console.log("❌ No recent emails found.");
      return null;
    }

    for (let msg of res.data.messages) {
      const message = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
      });

      const body = Buffer.from(
        message.data.payload.parts
          ? message.data.payload.parts[0].body.data
          : message.data.payload.body.data,
        "base64"
      ).toString("utf-8");

      const match = body.match(/\b\d{6}\b/);
      if (match) {
        console.log("✅ 2FA Code Found:", match[0]);
        return match[0];
      }
    }

    return null;
  } catch (err) {
    console.error("❌ Gmail API Error:", err.message);
    return null;
  }
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
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115 Safari/537.36"
    );

    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    console.log("🌐 Opening Sarvinarck login...");

    await page.goto("https://app.sarvinarck.com/sign-in", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // extra wait for React hydration
    await new Promise((r) => setTimeout(r, 8000));

    const emailSelector =
      'input[name="loginId"], input[type="email"], input[placeholder*="email"]';
    const passwordSelector =
      'input[name="password"], input[type="password"]';

    console.log("🔍 Waiting for login fields...");

    await page.waitForSelector(emailSelector, { timeout: 60000 });

    await page.type(emailSelector, CONFIG.email, { delay: 50 });
    await page.type(passwordSelector, CONFIG.password, { delay: 50 });

    await page.keyboard.press("Enter");

    console.log("⏳ Waiting for 2FA input...");

    await page.waitForSelector('input[name="code"], input[type="text"]', {
      timeout: 60000,
    });

    const code = await getLatestCode();

    if (!code) throw new Error("2FA code not found");

    await page.type('input[name="code"], input[type="text"]', code, {
      delay: 80,
    });

    await page.keyboard.press("Enter");

    await page.waitForFunction(
      () => !window.location.href.includes("sign-in"),
      { timeout: 60000 }
    );

    console.log("🔎 Searching for apiToken cookie...");

    let foundToken = null;

    for (let i = 0; i < 10; i++) {
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
