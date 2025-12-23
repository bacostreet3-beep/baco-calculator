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
      maxFileSize: 20 * 1024 * 1024, // Gemini 3 支援更大的上下文，但 Vercel 仍有上傳限制
    });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve([fields, files]);
      });
    });

    const textPrompt = fields.text ? fields.text.toString() : '';
    const imageFile = files.image ? (Array.isArray(files.image) ? files.image[0] : files.image) : null;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // --- 修正點：使用 2025 年 12 月最新的 Gemini 3 Flash ---
    // 根據 Google Blog (2025/12/17)，Gemini 3 Flash 已開放 API
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash" });

    let prompt = `
      角色：專業烘焙數據分析師 (Gemini 3 Powered)。
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
    const ingredients = JSON.parse(text);

    res.status(200).json({ data: ingredients });

  } catch (error) {
    console.error('Gemini 3 API Error:', error);
    // 回傳詳細錯誤以便除錯
    res.status(500).json({ 
      error: 'AI 辨識失敗', 
      details: error.message || '請檢查 API Key 或模型權限'
    });
  }
}
