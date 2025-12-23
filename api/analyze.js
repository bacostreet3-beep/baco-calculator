import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { image, text } = req.body;

    if (!process.env.GOOGLE_API_KEY) {
      throw new Error("API Key 未設定，請檢查 Vercel 環境變數");
    }

    const systemPrompt = `
      你是一個專業的烘焙助手。請分析圖片中的食譜或文字。
      請擷取食材名稱與重量（公克）。
      【重要規則】
      1. 只回傳純 JSON 格式。
      2. 格式必須是物件陣列：[{"name": "食材名", "weight": 數字}, ...]
      3. 不要包含 Markdown 標記。
      4. 若無重量預設為 0。
    `;

    const parts = [systemPrompt];
    if (text) parts.push(`使用者補充：${text}`);
    
    if (image) {
      const base64Data = image.includes('base64,') ? image.split('base64,')[1] : image;
      parts.push({
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg",
        },
      });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(parts);
    const response = await result.response;
    let textResponse = response.text();

    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

    let ingredients = [];
    try {
      ingredients = JSON.parse(textResponse);
    } catch (e) {
      return res.status(500).json({ error: "AI 回傳格式看不懂，請再試一次" });
    }

    return res.status(200).json({ data: ingredients });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: error.message || "伺服器發生錯誤" });
  }
}
