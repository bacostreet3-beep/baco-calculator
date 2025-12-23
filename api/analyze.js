import { GoogleGenerativeAI } from "@google/generative-ai";

// 設定：允許最大 10MB 的資料傳輸
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

    // 檢查 API Key
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error("伺服器端未設定 GOOGLE_API_KEY");
    }

    // 準備給 AI 的提示詞
    const systemPrompt = `
      你是一個專業的烘焙助手。請分析圖片中的食譜或文字。
      請擷取食材名稱與重量（公克）。
      
      【重要規則】
      1. 只回傳純 JSON 格式。
      2. 格式必須是物件陣列：[{"name": "食材名", "weight": 數字}, ...]
      3. 不要包含任何 Markdown 標記 (如 \`\`\`json)。
      4. 如果沒有重量，預設為 0。
      5. 如果圖片不是食譜，回傳空陣列 []。
    `;

    const parts = [systemPrompt];
    if (text) parts.push(`使用者補充說明：${text}`);
    
    // 處理圖片
    if (image) {
      // 移除 base64 前綴，只保留資料
      const base64Data = image.includes('base64,') ? image.split('base64,')[1] : image;
      parts.push({
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg",
        },
      });
    }

    // 呼叫 AI
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(parts);
    const response = await result.response;
    let textResponse = response.text();

    // 清理回應
    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

    // 解析 JSON
    let ingredients = [];
    try {
      ingredients = JSON.parse(textResponse);
    } catch (e) {
      return res.status(500).json({ error: "AI 回傳格式錯誤，請重試", raw: textResponse });
    }

    return res.status(200).json({ data: ingredients });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: error.message || "伺服器發生錯誤" });
  }
}
