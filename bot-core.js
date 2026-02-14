const puppeteer = require("puppeteer");
const axios = require("axios");
const { google } = require("googleapis");

/* ---------------------------------------------------
   ENV CONFIG
--------------------------------------------------- */

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
   GMAIL API SETUP (OAuth2)
--------------------------------------------------- */

const oAuth2Client = new google.auth.OAuth2(
  CONFIG.gmailClientId,
  CONFIG.gmailClientSecret
);

oAuth2Client.setCredentials({
  refresh_token: CONFIG.gmailRefreshToken,
});

const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

/* ---------------------------------------------------
   GET LATEST 2FA CODE FROM GMAIL USING API
--------------------------------------------------- */

async function getLatestCode() {
  try {
    console.log("📩 Checking Gmail for 2FA code...");

    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: 5,
      q: "newer_than:5m",
    });

    if (!res.data.messages || res.data.messages.length === 0) {
      console.log("❌ No recent emails found.");
      return null;
    }

    for (const msg of res.data.messages) {
      const message = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });

      const parts = message.data.payload.parts || [];
      let body = "";

      for (const part of parts) {
        if (part.mimeType === "text/plain") {
          body = Buffer.from(part.body.data, "base64").toString("utf-8");
        }
      }

      if (!body && message.data.payload.body?.data) {
        body = Buffer.from(
          message.data.payload.body.data,
          "base64"
        ).toString("utf-8");
      }

      const codeMatch = body.match(/\b\d{6}\b/);
      if (codeMatch) {
        console.log("✅ 2FA Code Found:", codeMatch[0]);
        return codeMatch[0];
      }
    }

    console.log("❌ 2FA code not found in recent emails.");
    return null;
  } catch (error) {
    console.error("❌ Gmail API Error:", error.message);
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
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
      ],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);

    // Block heavy resources
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "stylesheet", "font", "media"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log("🌐 Opening Sarvinarck login...");
    await page.goto("https://app.sarvinarck.com/sign-in", {
      waitUntil: "domcontentloaded",
    });

    await page.waitForSelector('input[name="loginId"]');
    await page.type('input[name="loginId"]', CONFIG.email, { delay: 20 });

    await page.waitForSelector('input[name="password"]');
    await page.type('input[name="password"]', CONFIG.password, { delay: 20 });

    await page.keyboard.press("Enter");

    console.log("⏳ Waiting for 2FA input...");
    await page.waitForSelector('input[name="code"]', {
      visible: true,
      timeout: 45000,
    });

    const code = await getLatestCode();
    if (!code) throw new Error("2FA code not found");

    await page.type('input[name="code"]', code, { delay: 50 });
    await page.keyboard.press("Enter");

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
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      }
    );

    console.log("✅ Token synced successfully!");
  } catch (err) {
    console.error("❌ Core Bot Error:", err.message);
    throw err;
  } finally {
    if (browser) await browser.close();
    console.log("🤖 Core Bot Finished");
  }
}

module.exports = { runBot };
