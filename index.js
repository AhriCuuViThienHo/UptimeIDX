require("dotenv").config();
const fs = require("fs");
const express = require("express");
const { google } = require("googleapis");
const TOKEN_PATH = "./tokens.json";

let lastStatus = {
  idx: false,
  updatedAt: null,
};

// ==== Helpers ====
async function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error("⚠️ tokens.json chưa tồn tại, cần login Gmail OAuth trước");
  }

  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    if (!data.refresh_token) {
      throw new Error("⚠️ tokens.json thiếu refresh_token, cần login lại");
    }
    return data;
  } catch (err) {
    throw new Error("⚠️ tokens.json lỗi hoặc bị hỏng: " + err.message);
  }
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

// ==== IDX Ping ====
async function pingIdx(oAuth2Client) {
  try {
    const tokens = oAuth2Client.credentials;
    let res = await fetch(process.env.IDX_URL, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    if (res.status === 200) return true;

    if ([401, 403, 404].includes(res.status)) {
      console.log(`⚠️ IDX lỗi ${res.status}, thử refresh token...`);
      const newTokens = await refreshTokens(oAuth2Client);
      if (!newTokens) return false;

      res = await fetch(process.env.IDX_URL, {
        headers: {
          Authorization: `Bearer ${newTokens.access_token}`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        },
      });

      return res.status === 200;
    }
    return false;
  } catch (err) {
    console.error("❌ Lỗi khi ping IDX:", err.message);
    return false;
  }
}

// ==== Job loop ====
async function main() {
  let oAuth2Client;
  try {
    oAuth2Client = await getOAuth2Client();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  async function job() {
    const idxOK = await pingIdx(oAuth2Client);
    lastStatus = {
      idx: idxOK,
      updatedAt: new Date().toISOString(),
    };
    console.log(`${lastStatus.updatedAt} | IDX: ${idxOK ? "🟢" : "❌"}`);
  }

  setInterval(job, 60000); // check mỗi phút
  await job();

  // ==== Express server ====
  const app = express();

  app.get("/", (req, res) => {
    res.send(`
      <html>
        <head>
          <meta charset="utf-8" />
          <title>IDX Status</title>
          <style>
            body { font-family: sans-serif; background: #111; color: #eee; text-align: center; padding: 40px; }
            .ok { color: #0f0; }
            .fail { color: #f00; }
            .box { margin: 20px auto; padding: 20px; border: 1px solid #444; width: 300px; border-radius: 10px; background: #222; }
          </style>
        </head>
        <body>
          <h1>IDX Status</h1>
          <div class="box">
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
