const { GoogleGenerativeAI } = require("@google/generative-ai");
const formidable = require('formidable');
const fs = require('fs');

// Vercel Serverless Config: 必須關閉內建解析，才能使用 formidable 處理檔案上傳
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // 1. 只允許 POST 請求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 2. 解析前端傳來的 Form Data (支援圖片與文字)
    const form = formidable({
      keepExtensions: true,
      maxFileSize: 20 * 1024 * 1024, // 2025年了，我們把限制放寬到 20MB
    });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve([fields, files]);
      });
    });

    // 取得資料 (相容 formidable 不同版本的陣列回傳格式)
    const textPrompt = fields.text ? fields.text.toString() : '';
    const imageFile = files.image ? (Array.isArray(files.image) ? files.image[0] : files.image) : null;

    // 3. 初始化 Google Gemini AI (使用 2.5 Flash)
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // update: 2025.12 使用 gemini-2.5-flash
    // 若您的 API Key 權限尚未開通 2.5，請暫時改回 gemini-1.5-flash
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 4. 建構 Prompt
    let prompt = `
      角色：專業烘焙數據分析師。
      任務：從提供的食譜（圖片或文字）中提取食材與重量。
      
      輸出規則：
      1. 只回傳純 JSON Array，不要 Markdown 標記 (\`\`\`)。
      2. 單位轉換：所有非公克單位（匙、杯、ml）請依烘焙經驗轉換為克 (g)。
      3. 格式範例：[{"name": "高筋麵粉", "weight": 500}, {"name": "水", "weight": 350}]
      4. 若無食材或無法辨識，回傳 []。
    `;

    if (textPrompt) {
      prompt += `\n\n補充說明/食譜文字：${textPrompt}`;
    }

    let result;
    
    // 5. 執行推論 (支援多模態)
    if (imageFile) {
      const imageBuffer = fs.readFileSync(imageFile.filepath);
      const imageBase64 = imageBuffer.toString('base64');
      
      const imagePart = {
        inlineData: {
          data: imageBase64,
          mimeType: imageFile.mimetype
        }
      };

      // 2.5 Flash 處理圖片速度極快
      result = await model.generateContent([prompt, imagePart]);
    } else {
      result = await model.generateContent(prompt);
    }

    // 6. 處理與清理回應
    const response = await result.response;
    let text = response.text();

    // 強制清理可能殘留的 json 標記
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    // 解析 JSON
    const ingredients = JSON.parse(text);

    res.status(200).json({ data: ingredients });

  } catch (error) {
    console.error('AI Analysis Error:', error);
    // 回傳具體錯誤給前端，方便除錯
    res.status(500).json({ 
      error: 'AI 辨識失敗', 
      details: error.message 
    });
  }
}
