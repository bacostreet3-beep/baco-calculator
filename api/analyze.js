const { GoogleGenerativeAI } = require("@google/generative-ai");
const formidable = require('formidable');
const fs = require('fs');

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // 1. 設置 CORS 標頭，允許跨域請求 (避免有些瀏覽器擋住)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 處理 OPTIONS 預檢請求
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const form = formidable({
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
    });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve([fields, files]);
      });
    });

   // ... (前段程式碼省略)

    const apiKey = process.env.GOOGLE_API_KEY; // 修正變數名稱
    if (!apiKey) {
        throw new Error("找不到 API Key (GOOGLE_API_KEY)");
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // --- 修正：使用 2025 年 12 月最新的 Gemini 3 Flash ---
    // 根據文件，Gemini 1.5 已經在 9 月停止支援
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash" }); 

// ... (後段程式碼省略)

    let prompt = `
      角色：專業烘焙數據分析師。
      任務：從食譜中提取食材與重量。
      規則：
      1. 只回傳純 JSON Array 格式。
      2. 所有單位請自動換算為公克(g)。
      3. 格式範例：[{"name": "麵粉", "weight": 100}, {"name": "糖", "weight": 50}]
    `;

    if (textPrompt) prompt += `\n\n補充說明：${textPrompt}`;

    let result;
    
    if (imageFile) {
      const imageBuffer = fs.readFileSync(imageFile.filepath);
      const imageBase64 = imageBuffer.toString('base64');
      const imagePart = {
        inlineData: {
          data: imageBase64,
          mimeType: imageFile.mimetype
        }
      };
      result = await model.generateContent([prompt, imagePart]);
    } else {
      result = await model.generateContent(prompt);
    }

    const response = await result.response;
    let text = response.text();
    
    // 清理 Markdown 標記
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    // 嘗試解析 JSON
    let ingredients;
    try {
        ingredients = JSON.parse(text);
    } catch (e) {
        console.error("JSON 解析失敗，原始回傳:", text);
        return res.status(500).json({ error: "AI 回傳格式無法讀取", details: text });
    }

    res.status(200).json({ data: ingredients });

  } catch (error) {
    console.error('API 執行錯誤:', error);
    res.status(500).json({ 
      error: 'AI 辨識過程發生錯誤', 
      details: error.message 
    });
  }
}
