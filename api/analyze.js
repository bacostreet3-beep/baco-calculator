import { GoogleGenerativeAI } from "@google/generative-ai";

// 設定：允許接收最大 10MB 的 JSON (包含 Base64 圖片)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export default async function handler(req, res) {
  // 1. 確保只接受 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 2. 直接從 JSON body 拿資料 (對應你的前端 JSON.stringify)
    const { image, text } = req.body;

    // 檢查是否有 API Key
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error("伺服器端未設定 GOOGLE_API_KEY");
    }

    if (!image && !text) {
      return res.status(400).json({ error: '未接收到圖片或文字資料' });
    }

    // 3. 處理圖片 (移除 base64 前綴)
    let imagePart = null;
    if (image) {
      const base64Data = image.includes('base64,') ? image.split('base64,')[1] : image;
      imagePart = {
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg",
        },
      };
    }

    // 4. 設定 Prompt
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
    if (imagePart) parts.push(imagePart);

    // 5. 呼叫 Gemini
    console.log("正在呼叫 Gemini API...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(parts);
    const response = await result.response;
    let textResponse = response.text();

    console.log("Gemini 回傳原始資料:", textResponse);

    // 6. 清理並解析 JSON
    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let ingredients = [];
    try {
      ingredients = JSON.parse(textResponse);
    } catch (e) {
      console.error("JSON 解析失敗:", textResponse);
      // 如果 AI 沒回傳 JSON，嘗試回傳空陣列或錯誤提示，不要讓伺服器崩潰
      return res.status(500).json({ error: "AI 回傳了無法解析的格式", raw: textResponse });
    }

    // 7. 成功回傳
    return res.status(200).json({ data: ingredients });

  } catch (error) {
    console.error("API 發生錯誤:", error);
    
    // 捕捉所有錯誤並回傳 JSON
    return res.status(500).json({ 
      error: error.message || "伺服器發生未知錯誤",
      details: error.toString() 
    });
  }
}
