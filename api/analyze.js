// api/analyze.js
require("dotenv").config();

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const formidable = require("formidable");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = path.join(__dirname, ".."); // 專案根目錄（index.html 所在）

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("❌ 找不到 API Key：請設定環境變數 GOOGLE_API_KEY");
  process.exit(1);
}

// Gemini 2.5 Flash（穩定版 model code：gemini-2.5-flash）
// 參考：Google AI for Developers - Gemini models :contentReference[oaicite:1]{index=1}
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
      ? "text/css; charset=utf-8"
      : ext === ".js"
      ? "application/javascript; charset=utf-8"
      : "application/octet-stream";

  try {
    const buf = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(buf);
  } catch (e) {
    sendText(res, 404, "Not Found");
  }
}

function extractJsonArray(text) {
  // 1) 去掉常見 code fence
  let t = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // 2) 嘗試抓第一個 JSON Array 區段（避免模型夾雜解釋）
  const m = t.match(/\[[\s\S]*\]/);
  if (m) t = m[0].trim();

  return t;
}

async function handleAnalyze(req, res) {
  const form = formidable({
    keepExtensions: true,
    maxFileSize: 10 * 1024 * 1024,
    uploadDir: os.tmpdir(),
    multiples: false,
  });

  const [fields, files] = await new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve([fields, files]);
    });
  });

  const textPrompt = fields.text ? String(fields.text) : "";

  // formidable v3 的檔案路徑屬性是 filepath（有些環境/版本會是 path）
  // filepath: string :contentReference[oaicite:2]{index=2}
  const imageFile = files.image
    ? Array.isArray(files.image)
      ? files.image[0]
      : files.image
    : null;

  if (!textPrompt && !imageFile) {
    return sendJson(res, 400, { error: "請輸入文字或選擇圖片！" });
  }

  const prompt = `
角色：專業烘焙數據分析師
任務：從食譜中精準提取「食材」與「重量」
規則（非常重要）：
1) 只能回傳「純 JSON Array」，不要任何說明文字
2) 所有單位一律換算成公克 g（只回傳數字）
3) 格式固定為：[{ "name": "食材", "weight": 123 }]
4) 如果遇到「適量/少許」等無法換算者，weight 請填 0
`.trim();

  const fullPrompt = textPrompt ? `${prompt}\n\n食譜文字：\n${textPrompt}` : prompt;

  let result;
  if (imageFile) {
    const filePath = imageFile.filepath || imageFile.path; // 兼容
    const mimeType = imageFile.mimetype || imageFile.type || "image/jpeg";

    const imageBuffer = fs.readFileSync(filePath);
    const imageBase64 = imageBuffer.toString("base64");

    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType,
      },
    };

    result = await model.generateContent([fullPrompt, imagePart]);
  } else {
    result = await model.generateContent(fullPrompt);
  }

  const response = await result.response;
  const rawText = response.text();

  const jsonText = extractJsonArray(rawText);

  let ingredients;
  try {
    ingredients = JSON.parse(jsonText);
  } catch (e) {
    console.error("❌ JSON Parse Error. RAW:\n", rawText);
    return sendJson(res, 500, {
      error: "AI 回傳格式錯誤，無法解析為 JSON",
      details: "請稍後重試，或調整食譜輸入更清楚（每行：食材 + 數字 + 單位）",
    });
  }

  if (!Array.isArray(ingredients)) {
    return sendJson(res, 500, {
      error: "AI 回傳格式錯誤",
      details: "回傳不是 JSON Array",
    });
  }

  // 輕度清理
  const cleaned = ingredients.map((x) => ({
    name: (x && x.name ? String(x.name) : "未知食材").trim(),
    weight: Number(x && x.weight ? x.weight : 0) || 0,
  }));

  return sendJson(res, 200, { data: cleaned });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // API
    if (url.pathname === "/api/analyze") {
      if (req.method !== "POST") {
        return sendJson(res, 405, { error: "Method Not Allowed" });
      }
      return await handleAnalyze(req, res);
    }

    // 靜態檔案（預設回 index.html）
    if (req.method !== "GET") {
      return sendText(res, 405, "Method Not Allowed");
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, "");
    const filePath = path.join(ROOT_DIR, safePath);

    // 防穿越
    if (!filePath.startsWith(ROOT_DIR)) {
      return sendText(res, 403, "Forbidden");
    }

    return sendFile(res, filePath);
  } catch (err) {
    console.error("Server Error:", err);
    return sendJson(res, 500, { error: "Server Error", details: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
  console.log(`✅ AI endpoint:  POST http://localhost:${PORT}/api/analyze`);
});
