require("dotenv").config();
const fs = require("fs");
const { google } = require("googleapis");
const TOKEN_PATH = "./tokens.json";

// ==== Helpers ====
async function loadTokens() {
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
}

async function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

async function getOAuth2Client() {
  const tokens = await loadTokens();
  const oAuth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
  );
  oAuth2Client.setCredentials(tokens);
  return oAuth2Client;
}

async function refreshTokens(oAuth2Client) {
  try {
    const { credentials } = await oAuth2Client.refreshAccessToken();
    await saveTokens(credentials);
    console.log("🔄 Token refreshed");
    return credentials;
  } catch (err) {
    console.error("❌ Refresh token lỗi:", err.message);
    return null;
  }
}

// ==== Gmail Check ====
async function checkGmail(oAuth2Client) {
  try {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
    const res = await gmail.users.labels.list({ userId: "me" });
    return res.status === 200;
  } catch (err) {
    console.error("❌ Gmail API lỗi:", err.message);
    return false;
  }
}

// ==== IDX Ping ====
async function pingIdx(oAuth2Client) {
  try {
    const tokens = oAuth2Client.credentials;

    let res = await fetch(process.env.IDX_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (res.status === 200) {
      return true;
    }

    if ([401, 403, 404].includes(res.status)) {
      console.log(`⚠️ IDX lỗi ${res.status}, thử refresh token...`);
      const newTokens = await refreshTokens(oAuth2Client);
      if (!newTokens) return false;

      res = await fetch(process.env.IDX_URL, {
        headers: { Authorization: `Bearer ${newTokens.access_token}` },
      });

      return res.status === 200;
    }

    return false;
  } catch (err) {
    console.error("❌ Ping IDX lỗi:", err.message);
    return false;
  }
}

// ==== Main loop ====
async function main() {
  const oAuth2Client = await getOAuth2Client();

  async function job() {
    const gmailOK = await checkGmail(oAuth2Client);
    const idxOK = await pingIdx(oAuth2Client);
    console.log(
      `${new Date().toISOString()} | 📧 Gmail: ${gmailOK ? "🟢" : "❌"} | IDX: ${idxOK ? "🟢" : "❌"}`
    );
  }

  setInterval(job, 60000);
  await job();
}

main();
