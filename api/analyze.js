import { GoogleGenerativeAI } from "@google/generative-ai";

// 初始化 Gemini API
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // 確保圖片上傳不會因為超過預設 1mb 而報錯
    },
  },
};

export default async function handler(req, res) {
  // 1. 檢查請求方法
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 2. 獲取前端傳來的資料
    // image: base64 字串
    // instruction: 使用者額外輸入的補充說明 (例如："這蛋糕烤得怎樣？")
    const { image, instruction } = req.body;

    if (!image) {
      return res.status(400).json({ error: '未接收到圖片資料 (Image data is missing)' });
    }

    if (!process.env.GOOGLE_API_KEY) {
      console.error("API Key missing");
      return res.status(500).json({ error: '伺服器端未設定 API Key' });
    }

    // 3. 處理 Base64 格式
    // 前端傳來的可能是 "data:image/png;base64,iVBOR..."，Gemini 只想要逗號後面的部分
    const base64Data = image.includes('base64,') 
      ? image.split('base64,')[1] 
      : image;

    // 4. 設定模型 (使用 flash 模型速度較快且便宜，適合圖片辨識)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // 5. 準備 Prompt (提示詞)
    // 這裡結合了使用者的 instruction 和我們預設的系統提示
    const prompt = instruction 
      ? `請分析這張圖片。使用者的問題或說明是：「${instruction}」。請根據圖片內容給出專業的回答。`
      : "請詳細分析這張圖片的內容，如果是食物，請分析其外觀與可能的製作問題。";

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: "image/jpeg", // 即使原始是 png，傳給 Gemini 標註 jpeg 通常也通吃，或者你可以從前端傳 mimeType 進來
      },
    };

    // 6. 發送請求給 Gemini
    console.log("開始發送請求給 Google Gemini...");
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    console.log("Gemini 回應成功");

    // 7. 回傳成功結果 (JSON 格式)
    return res.status(200).json({ result: text });

  } catch (error) {
    // 8. 錯誤處理 (最重要的一步)
    console.error("Backend Error:", error);
    
    // 判斷是否為 Google API 的特定錯誤
    let errorMessage = error.message || "伺服器發生未知錯誤";
    
    if (errorMessage.includes("API key not valid")) {
      errorMessage = "API Key 無效，請檢查 .env 設定";
    } else if (errorMessage.includes("candidate")) {
      errorMessage = "AI 無法處理這張圖片 (可能是安全性攔截)";
    }

    // 確保這裡回傳的是 JSON，前端才不會報 "Unexpected token 'A'"
    return res.status(500).json({ 
      error: errorMessage,
      details: error.toString() // 方便除錯用
    });
  }
}
