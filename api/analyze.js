const { GoogleGenerativeAI } = require("@google/generative-ai");
const formidableLib = require("formidable");
const fs = require("node:fs");

export const config = {
  api: {
    bodyParser: false,
  },
};

// ✅ 兼容 formidable v3：require('formidable') 會回傳物件，不一定是 function
function createForm(options) {
  // v3 常見：{ formidable, IncomingForm, Formidable, ... }
  if (formidableLib && typeof formidableLib.formidable === "function") {
    return formidableLib.formidable(options);
  }

  // 少數環境：default export 是 function
  if (formidableLib && typeof formidableLib.default === "function") {
    return formidableLib.default(options);
  }

  // 舊用法：new IncomingForm()
  const IncomingFormCtor = formidableLib.IncomingForm || formidableLib.Formidable;
  if (IncomingFormCtor) {
    return new IncomingFormCtor(options);
  }

  // 最後保底：如果整個 require 回來就是 function
  if (typeof formidableLib === "function") {
    return formidableLib(options);
  }

  throw new TypeError("formidable 初始化失敗：找不到 formidable() 或 IncomingForm/Formidable");
}

function toStrField(v) {
  if (v == null) return "";
  // formidable fields 可能是 string 或 string[]
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function pickFirstFile(files, key) {
  if (!files || !files[key]) return null;
  return Array.isArray(files[key]) ? files[key][0] : files[key];
}

function extractJsonArray(text) {
  // 先移除 ```json ``` 包裹
  let t = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // 嘗試直接 parse
  try {
    return JSON.parse(t);
  } catch (_) {
    // 再嘗試抓出第一段 [...]（避免模型多講話）
    const start = t.indexOf("[");
    const end = t.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      const sliced = t.slice(start, end + 1);
      return JSON.parse(sliced);
    }
    throw new Error("AI 回傳格式錯誤，找不到可解析的 JSON Array");
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const form = createForm({
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024,
      multiples: false,
    });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve([fields, files]);
      });
    });

    const textPrompt = toStrField(fields.text);
    const imageFile = pickFirstFile(files, "image");

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "找不到 API Key (GOOGLE_API_KEY)",
        details: "請到部署平台環境變數設定 GOOGLE_API_KEY",
      });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // ✅ 你想用 Gemini 2.5：使用 gemini-2.5-flash
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    const prompt = `
角色：專業烘焙數據分析師。
任務：從食譜中精準提取「食材」與「重量」。
規則：
1) 嚴格回傳「純 JSON Array」，不要多任何說明文字。
2) 將所有單位轉換為公克 (g)。
3) 格式必須是：
[
  {"name":"食材", "weight": 123},
  ...
]
`.trim();

    let result;

    if (imageFile) {
      const filepath = imageFile.filepath || imageFile.path; // ✅ 兼容不同版本欄位
      if (!filepath) throw new Error("上傳圖片缺少 filepath/path");

      const imageBuffer = fs.readFileSync(filepath);
      const imageBase64 = imageBuffer.toString("base64");

      const imagePart = {
        inlineData: {
          data: imageBase64,
          mimeType: imageFile.mimetype || "image/png",
        },
      };

      const fullPrompt = textPrompt ? `${prompt}\n\n食譜文字補充：\n${textPrompt}` : prompt;
      result = await model.generateContent([fullPrompt, imagePart]);
    } else {
      if (!textPrompt) throw new Error("請輸入文字或選擇圖片！");
      result = await model.generateContent(`${prompt}\n\n食譜文字：\n${textPrompt}`);
    }

    const response = await result.response;
    const rawText = response.text();

    const parsed = extractJsonArray(rawText);

    if (!Array.isArray(parsed)) {
      throw new Error("AI 回傳不是 JSON Array");
    }

    // ✅ 清理輸出：確保 name/weight 型別正確
    const ingredients = parsed
      .map((x) => ({
        name: String(x?.name ?? "").trim() || "未知食材",
        weight: Number(x?.weight ?? 0) || 0,
      }))
      .filter((x) => x.name);

    return res.status(200).json({ data: ingredients });
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({
      error: error?.message || "AI 辨識失敗",
      details: error?.stack ? String(error.stack) : "",
    });
  }
}
