import { GoogleGenerativeAI } from "@google/generative-ai";
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false, // 必須關閉，才能用 formidable 處理檔案上傳
  },
};

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 1. 解析上傳的檔案
    const form = formidable({ keepExtensions: true });
    const [fields, files] = await form.parse(req);

    const imageFile = files.image?.[0]; // 取得上傳的圖片
    const instruction = fields.instruction?.[0]; // 取得使用者的補充說明

    if (!imageFile) {
      return res.status(400).json({ error: '未接收到圖片檔案' });
    }

    // 2. 讀取圖片並轉為 Base64
    const imageBuffer = fs.readFileSync(imageFile.filepath);
    const base64Image = imageBuffer.toString('base64');

    // 3. 設定 Gemini 模型
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // 4. 準備 Prompt
    const prompt = instruction 
      ? `請分析這張圖片。使用者的問題或說明是：「${instruction}」。請根據圖片內容給出專業的回答。如果這是食譜，請列出食材與步驟。`
      : "請詳細分析這張圖片的內容。如果是食譜，請幫我轉換成文字格式。";

    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: imageFile.mimetype || "image/jpeg",
      },
    };

    console.log("正在向 Gemini 發送請求...");

    // 5. 發送請求
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    console.log("Gemini 分析完成");

    // 6. 回傳成功結果
    return res.status(200).json({ result: text });

  } catch (error) {
    console.error("API Error:", error);
    
    // 這裡是最重要的修改：
    // 無論發生什麼錯，都回傳 JSON，前端才不會報 "Unexpected token"
    return res.status(500).json({ 
      error: "伺服器發生錯誤", 
      details: error.message 
    });
  }
}
