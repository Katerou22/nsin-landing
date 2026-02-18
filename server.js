const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { parse: parseQS, stringify: stringifyQS } = require("node:querystring");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const MAX_BODY = 64 * 1024;
const STATIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const server = http.createServer((req, res) => {
  if (req.url === "/waitlist" && req.method === "POST") {
    return handleWaitlist(req, res);
  }

  serveStatic(req, res);
});

function serveStatic(req, res) {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  if (reqPath === "/") reqPath = "/index.html";

  const filePath = path.join(STATIC_DIR, reqPath);
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not Found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

function handleWaitlist(req, res) {

  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (!ct.startsWith("application/x-www-form-urlencoded")) {
    res.writeHead(415, { "Content-Type": "text/plain" });
    return res.end("Unsupported Media Type");
  }

  let body = "";
  let size = 0;

  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      req.destroy();
      res.writeHead(413, { "Content-Type": "text/plain" });
      return res.end("Payload Too Large");
    }
    body += chunk;
  });

  req.on("end", () => handleForm(body, res));
});

async function handleForm(body, res) {
  const form = parseQS(body);

  // Honeypot
  if (form.hp_field) {
    res.writeHead(204);
    return res.end();
  }

  const name = (form.name || "").trim();
  const email = (form.email || "").trim();
  const company = (form.company || "").trim();
  const phone = (form.phone || "").trim();
  const desc = (form.desc || "").trim();

  if (!name || !email || !company || !phone || !desc) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    return res.end("Missing required fields");
  }

  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    return res.end("Server not configured");
  }

  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const msg =
    `🆕 New waitlist signup (nsin.ir)\n` +
    `👤 Name: ${esc(name)}\n` +
    `📧 Email: ${esc(email)}\n` +
    `🏢 Company: ${esc(company)}\n` +
    `📞 Phone: ${esc(phone)}\n` +
    `📝 Use case:\n${esc(desc)}`;

  try {
    await sendTelegram(msg);
    respondJSON(res, 200, { ok: true });
  } catch (err) {
    console.error("telegram error:", err.message || err);
    respondJSON(res, 502, { ok: false, error: "upstream error" });
  }
}

function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    const postData = stringifyQS({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: "true",
    });

    const options = {
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: 5000,
      family: 4,
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(`telegram ${res.statusCode}: ${body}`));
      });
    });

    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

function respondJSON(res, status, payload) {
  const json = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

server.listen(PORT, HOST, () => {
  console.log(`nsin server listening on ${HOST}:${PORT}`);
});
