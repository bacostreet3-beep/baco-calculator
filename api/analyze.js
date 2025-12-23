const { GoogleGenerativeAI } = require("@google/generative-ai");
const formidable = require('formidable');
const fs = require('fs');

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const form = formidable({
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024,
    });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve([fields, files]);
      });
    });

    const textPrompt = fields.text ? fields.text.toString() : '';
    // 修正: 確保能抓到正確的檔案物件 (處理陣列或單一物件)
    const imageFile = files.image ? (Array.isArray(files.image) ? files.image[0] : files.image) : null;

const apiKey = process.env.GOOGLE_API_KEY; // 修正變數名稱
    if (!apiKey) {
        throw new Error("找不到 API Key (GOOGLE_API_KEY)");
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // --- 修正：使用 2025 年 12 月最新的 Gemini 3 Flash ---
    // 根據文件，Gemini 1.5 已經在 9 月停止支援
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash" });
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    let prompt = `
      角色：專業烘焙數據分析師。
      任務：從食譜中精準提取食材與重量。
      規則：
      1. 嚴格回傳純 JSON Array。
      2. 將所有單位轉換為公克 (g)。
      3. 格式：[{"name": "食材", "weight": 數字}]
    `;

    if (textPrompt) prompt += `\n\n食譜文字：${textPrompt}`;

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
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // 嘗試解析 JSON，如果失敗則拋出錯誤
    let ingredients;
    try {
        ingredients = JSON.parse(text);
    } catch (e) {
        console.error("JSON Parse Error:", text);
        throw new Error("AI 回傳格式錯誤，無法解析為 JSON");
    }

    res.status(200).json({ data: ingredients });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ 
      error: 'AI 辨識失敗', 
      details: error.message 
    });
  }
}
