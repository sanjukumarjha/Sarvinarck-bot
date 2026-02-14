const puppeteer = require("puppeteer");
const { google } = require("googleapis");
const axios = require("axios");

const CONFIG = {
  email: process.env.SARVINARCK_EMAIL,
  password: process.env.SARVINARCK_PASSWORD,
  supabaseUrl: process.env.SUPABASE_FUNCTION_URL,
  gmailUser: process.env.GMAIL_USER,
  clientId: process.env.GMAIL_CLIENT_ID,
  clientSecret: process.env.GMAIL_CLIENT_SECRET,
  refreshToken: process.env.GMAIL_REFRESH_TOKEN,
};

/* ---------------------------------------
   GMAIL API SETUP
--------------------------------------- */
const oAuth2Client = new google.auth.OAuth2(
  CONFIG.clientId,
  CONFIG.clientSecret
);

oAuth2Client.setCredentials({
  refresh_token: CONFIG.refreshToken,
});

const gmail = google.gmail({
  version: "v1",
  auth: oAuth2Client,
});

/* ---------------------------------------
   GET LATEST 2FA CODE USING GMAIL API
--------------------------------------- */
async function getLatestCode() {
  try {
    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: 5,
      q: "newer_than:5m",
    });

    if (!res.data.messages) return null;

    for (const msg of res.data.messages) {
      const message = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });

      const parts = message.data.payload.parts || [];
      let body = "";

      for (const part of parts) {
        if (part.mimeType === "text/plain" && part.body.data) {
          body = Buffer.from(part.body.data, "base64").toString("utf-8");
        }
      }

      const match = body.match(/\b\d{6}\b/);
      if (match) {
        console.log("✅ 2FA Code Found");
        return match[0];
      }
    }

    return null;
  } catch (err) {
    console.error("❌ Gmail API Error:", err.message);
    return null;
  }
}

/* ---------------------------------------
   MAIN BOT LOGIC
--------------------------------------- */
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
    page.setDefaultTimeout(60000);

    await page.goto("https://app.sarvinarck.com/sign-in", {
      waitUntil: "domcontentloaded",
    });

    await page.type('input[name="loginId"]', CONFIG.email, { delay: 20 });
    await page.type('input[name="password"]', CONFIG.password, { delay: 20 });
    await page.keyboard.press("Enter");

    await page.waitForSelector('input[name="code"]', {
      timeout: 45000,
    });

    const code = await getLatestCode();
    if (!code) throw new Error("2FA code not found");

    await page.type('input[name="code"]', code, { delay: 50 });
    await page.keyboard.press("Enter");

    await page.waitForNavigation({ waitUntil: "networkidle2" });

    const cookies = await page.cookies();
    const tokenCookie = cookies.find((c) => c.name === "apiToken");

    if (!tokenCookie) throw new Error("apiToken not found");

    await axios.post(CONFIG.supabaseUrl, {
      access_token: tokenCookie.value,
    });

    console.log("✅ Token synced successfully");
  } catch (err) {
    console.error("❌ Core Bot Error:", err.message);
  } finally {
    if (browser) await browser.close();
    console.log("🤖 Core Bot Finished");
  }
}

module.exports = { runBot };
