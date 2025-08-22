require("dotenv").config();
const fs = require("fs");
const express = require("express");
const { google } = require("googleapis");

const TOKEN_PATH = "./tokens.json";

let lastStatus = {
  gmail: false,
  idx: false,
  updatedAt: null,
};

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
  } catch {
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

    if (res.status === 200) return true;

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
  } catch {
    return false;
  }
}

// ==== Job loop ====
async function main() {
  const oAuth2Client = await getOAuth2Client();

  async function job() {
    const gmailOK = await checkGmail(oAuth2Client);
    const idxOK = await pingIdx(oAuth2Client);
    lastStatus = {
      gmail: gmailOK,
      idx: idxOK,
      updatedAt: new Date().toISOString(),
    };
    console.log(`${lastStatus.updatedAt} | Gmail: ${gmailOK ? "🟢" : "❌"} | IDX: ${idxOK ? "🟢" : "❌"}`);
  }

  setInterval(job, 60000);
  await job();

  // ==== Express server ====
  const app = express();

  app.get("/", (req, res) => {
    res.send(`
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Status</title>
          <style>
            body { font-family: sans-serif; background: #111; color: #eee; text-align: center; padding: 40px; }
            .ok { color: #0f0; }
            .fail { color: #f00; }
            .box { margin: 20px auto; padding: 20px; border: 1px solid #444; width: 300px; border-radius: 10px; background: #222; }
          </style>
        </head>
        <body>
          <h1>Bot Status</h1>
          <div class="box">
            <p>📧 Gmail: <span class="${lastStatus.gmail ? "ok" : "fail"}">${lastStatus.gmail ? "🟢 Online" : "❌ Offline"}</span></p>
            <p>🌐 IDX: <span class="${lastStatus.idx ? "ok" : "fail"}">${lastStatus.idx ? "🟢 Online" : "❌ Offline"}</span></p>
            <p><small>⏰ Cập nhật: ${lastStatus.updatedAt || "chưa có"}</small></p>
          </div>
        </body>
      </html>
    `);
  });

  app.listen(process.env.PORT, () => {
    console.log(`🌐 Web status chạy tại http://localhost:${process.env.PORT}`);
  });
}

main();
