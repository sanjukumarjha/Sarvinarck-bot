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
    gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN
};

/* ---------------------------------------------------
   GMAIL API SETUP
--------------------------------------------------- */
const oAuth2Client = new google.auth.OAuth2(
    CONFIG.gmailClientId,
    CONFIG.gmailClientSecret
);

oAuth2Client.setCredentials({
    refresh_token: CONFIG.gmailRefreshToken
});

const gmail = google.gmail({
    version: "v1",
    auth: oAuth2Client
});

/* ---------------------------------------------------
   GET LATEST OTP FROM GMAIL
--------------------------------------------------- */
async function getLatestOTP() {
    console.log("📩 Checking Gmail for 2FA code...");

    // wait 35 seconds for OTP email to arrive
    await new Promise(resolve => setTimeout(resolve, 35000));

    const res = await gmail.users.messages.list({
        userId: "me",
        maxResults: 5
    });

    if (!res.data.messages) {
        throw new Error("No recent emails found.");
    }

    for (const msg of res.data.messages) {
        const email = await gmail.users.messages.get({
            userId: "me",
            id: msg.id,
            format: "full"
        });

        const headers = email.data.payload.headers;
        const subject = headers.find(h => h.name === "Subject");

        if (!subject || !subject.value.includes("Verification")) {
            continue;
        }

        let body = "";

        if (email.data.payload.parts) {
            for (const part of email.data.payload.parts) {
                if (
                    part.mimeType === "text/html" ||
                    part.mimeType === "text/plain"
                ) {
                    body = Buffer.from(
                        part.body.data,
                        "base64"
                    ).toString("utf8");
                    break;
                }
            }
        } else if (email.data.payload.body?.data) {
            body = Buffer.from(
                email.data.payload.body.data,
                "base64"
            ).toString("utf8");
        }

        const match = body.match(/\b\d{6}\b/);
        if (match) {
            console.log("✅ OTP Found:", match[0]);
            return match[0];
        }
    }

    throw new Error("2FA code not found");
}

/* ---------------------------------------------------
   MAIN BOT
--------------------------------------------------- */
async function runBot() {
    console.log("🤖 Core Bot Started");

    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    try {
        const page = await browser.newPage();

        console.log("🌐 Opening Sarvinarck login...");
        await page.goto("https://app.sarvinarck.com/sign-in", {
            waitUntil: "domcontentloaded"
        });

        await page.type('input[name="loginId"]', CONFIG.email);
        await page.type('input[name="password"]', CONFIG.password);
        await page.keyboard.press("Enter");

        console.log("⏳ Waiting for 2FA input...");
        await page.waitForSelector('input[name="code"]', {
            timeout: 60000
        });

        const otp = await getLatestOTP();

        console.log("🔐 Entering OTP...");
        await page.type('input[name="code"]', otp);
        await page.keyboard.press("Enter");

        await page.waitForTimeout(8000);

        const cookies = await page.cookies();
        const tokenCookie = cookies.find(c => c.name === "apiToken");

        if (!tokenCookie) {
            throw new Error("apiToken not found");
        }

        console.log("📡 Sending token to Supabase...");

        await axios.post(CONFIG.supabaseUrl, {
            access_token: tokenCookie.value
        });

        console.log("✅ Token synced successfully");

    } catch (err) {
        console.error("❌ Core Bot Error:", err.message);
        throw err;
    } finally {
        await browser.close();
        console.log("🤖 Core Bot Finished");
    }
}

module.exports = { runBot };
