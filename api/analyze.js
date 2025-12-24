import { GoogleGenerativeAI } from "@google/generative-ai";
import formidable from 'formidable';
import fs from 'fs';

// --- ★★★ 新增：頻率限制設定 (Rate Limiting) ★★★ ---
const RATE_LIMIT_RULES = {
  windowMs: 60 * 1000, // 限制時間窗口：1 分鐘
  ipLimit: 5,          // 單一 IP 限制：5 次
  globalLimit: 30      // 全站總限制：30 次
};

// 使用記憶體儲存請求紀錄 (注意：在 Serverless 環境下，這些變數在 Cold Start 後會重置，但足以防禦短時間攻擊)
const ipRequestCache = new Map();
let globalRequestTimestamps = [];

// 輔助函式：過濾掉超過 1 分鐘的舊紀錄
function cleanupTimestamps(timestamps) {
  const now = Date.now();
  return timestamps.filter(time => now - time < RATE_LIMIT_RULES.windowMs);
}
// --- ★★★ 設定結束 ★★★ ---


export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // --- ★★★ 步驟 0: 執行頻率限制檢查 ★★★ ---
  
  // 1. 取得客戶端 IP (處理 Vercel/Proxy 轉發的情境)
  const forwarded = req.headers['x-forwarded-for'];
  // 如果有多個 IP，取第一個 (真實 IP)
  const ip = forwarded ? forwarded.split(',')[0] : (req.socket.remoteAddress || 'unknown');

  const now = Date.now();

  // 2. 檢查「全站總限制」
  globalRequestTimestamps = cleanupTimestamps(globalRequestTimestamps);
  if (globalRequestTimestamps.length >= RATE_LIMIT_RULES.globalLimit) {
    console.warn(`[Rate Limit] Global limit reached. Current: ${globalRequestTimestamps.length}`);
    return res.status(429).json({ error: '系統繁忙，目前使用人數過多，請稍後再試。' });
  }

  // 3. 檢查「單一 IP 限制」
  let userTimestamps = ipRequestCache.get(ip) || [];
  userTimestamps = cleanupTimestamps(userTimestamps);
  
  if (userTimestamps.length >= RATE_LIMIT_RULES.ipLimit) {
    console.warn(`[Rate Limit] IP ${ip} blocked. Count: ${userTimestamps.length}`);
    return res.status(429).json({ error: '操作太頻繁，請休息一分鐘後再試！' });
  }

  // 4. 通過檢查，記錄這次請求
  userTimestamps.push(now);
  globalRequestTimestamps.push(now);
  ipRequestCache.set(ip, userTimestamps);

  // --- ★★★ 檢查結束，接續原本邏輯 ★★★ ---

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. 設定 Formidable
    const form = formidable({
      keepExtensions: true,
      allowEmptyFiles: false,
      minFileSize: 0,
    });

    // 2. 解析 Form Data
    let fields, files;
    try {
      [fields, files] = await form.parse(req);
    } catch (parseError) {
      console.error("Form parsing error:", parseError);
      return res.status(400).json({ error: '檔案上傳解析失敗' });
    }

    // 3. 安全地取得資料
    const rawText = fields.text ? fields.text[0] : '';
    const rawFile = files.image ? files.image[0] : null;

    // 4. 設定 Google AI
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

    // ✅ 使用最省錢的 Lite 模型
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-lite", 
      generationConfig: { responseMimeType: "application/json" } 
    });
    
    const prompt = `
      你是專業烘焙助手。請分析提供的食譜內容（文字或圖片）。
      任務：提取食材名稱(name)與重量(weight)。
      
      規則：
      1. 若只有比例沒有重量，weight 填 null (不要填 0)。
      2. 若單位不是公克，請自動換算成公克(g)。
      3. 若辨識不清，name 標記為 "(辨識不清)"。
      4. 只回傳純 JSON 陣列格式：[{ "name": "麵粉", "weight": 100 }, ...]
      5. 不要包含任何其他對話文字。
    `;

    // 5. 準備傳送給 AI 的資料
    let parts = [{ text: prompt }];

    // 處理圖片
    if (rawFile) {
      const filePath = rawFile.filepath || rawFile.path;
      if (filePath) {
        const imageData = fs.readFileSync(filePath);
        const imageBase64 = imageData.toString('base64');
        parts.push({
          inlineData: {
            mimeType: rawFile.mimetype || 'image/jpeg',
            data: imageBase64
          }
        });
      }
    }

    // 處理文字
    if (rawText && rawText.trim() !== '') {
      parts.push({ text: `額外補充食譜文字：${rawText}` });
    }

    // 6. 呼叫 AI
    const result = await model.generateContent(parts);
    const response = await result.response; // 取得 response 物件
    const responseText = response.text();
    
    // (選用) 印出 Token 用量，方便您監控成本
    if (response.usageMetadata) {
        console.log("💰 Token Usage:", response.usageMetadata);
    }

    console.log("AI Response:", responseText);

    // 7. 解析 JSON
    let data;
    try {
      const cleanJson = responseText.replace(/```json|```/g, '').trim();
      data = JSON.parse(cleanJson);
    } catch (jsonError) {
      console.error("JSON Parse Error:", jsonError, "Raw:", responseText);
      return res.status(500).json({ error: 'AI 回傳格式錯誤，無法解析' });
    }
    
    // 成功回傳
    res.status(200).json({ data });

  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: '伺服器內部錯誤：' + (error.message || '未知錯誤') });
  }
}
