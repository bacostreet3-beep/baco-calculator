const { GoogleGenerativeAI } = require("@google/generative-ai");
const formidable = require('formidable');
const fs = require('fs');

export const config = {
  api: {
    bodyParser: false,
  },
};

// --- 修改 1: 升級為更強大的 Gemini 2.0 模型 ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 增加限制設定，避免因為檔案過大直接報錯 (但仍受限於 Vercel 4.5MB 限制)
  const form = formidable({ 
    keepExtensions: true,
    maxFileSize: 10 * 1024 * 1024 // 10MB
  });

  try {
    const [fields, files] = await form.parse(req);

    // 準備給 AI 的內容陣列
    let parts = [];

    // 1. 處理文字輸入
    if (fields.text && fields.text[0]) {
      parts.push(fields.text[0]);
    }

    // 2. 處理圖片 (修正後的穩健寫法)
    if (files.image) {
      // 不管是一張還是一堆，通通轉成陣列，並過濾掉空的
      const uploadedFiles = Array.isArray(files.image) ? files.image : [files.image];

      for (const file of uploadedFiles) {
        // 安全檢查：確保檔案路徑存在
        if (file && file.filepath) {
            try {
                const imageData = fs.readFileSync(file.filepath).toString("base64");
                parts.push({
                  inlineData: {
                    data: imageData,
                    mimeType: file.mimetype || 'image/jpeg',
                  },
                });
            } catch (readErr) {
                console.error("讀取圖片失敗:", readErr);
                // 讀取失敗就跳過這張，不要讓整個程式當機
                continue;
            }
        }
      }
    }

    // 如果沒有文字也沒有圖片，就報錯
    if (parts.length === 0) {
        return res.status(400).json({ error: "沒有接收到任何文字或圖片" });
    }

    // 3. 系統提示詞
    const systemPrompt = `
      你是一個專業的烘焙食譜分析師。
      請分析上傳的圖片(可能有多張)或文字，提取出食譜中的「食材名稱」與「重量(克)」。
      
      規則：
      1. 如果圖片被切成多張（例如一張上半部、一張下半部），請綜合所有圖片資訊。
      2. 優先尋找重量單位為 g (公克) 的數值。如果是其他單位(lb, oz, 杯, 匙)，請盡量換算成公克。
      3. 忽略非食材項目（如器具、溫度、步驟說明）。
      4. 若有重複提到的食材，請自行判斷是否為同一項並合併，或取最合理的數值。
      5. 請務必回傳「純 JSON 陣列」，不要 Markdown，格式如下：
      [{"name": "麵粉", "weight": 100}, {"name": "水", "weight": 70}]
    `;
    
    parts.push(systemPrompt);

    // 4. 發送給 Gemini
    const result = await model.generateContent(parts);
    const response = await result.response;
    let text = response.text();

    // 清理可能回傳的 Markdown 符號
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
        const ingredients = JSON.parse(text);
        return res.status(200).json({ ingredients });
    } catch (e) {
        console.error("AI 回傳非 JSON:", text);
        // 如果 AI 回傳的不是 JSON，嘗試回傳錯誤訊息讓前端顯示
        return res.status(500).json({ error: "AI 分析失敗，請重試" });
    }

  } catch (error) {
    console.error("Server Error:", error);
    // 這裡是最重要的：捕捉所有伺服器錯誤，回傳 JSON 而不是讓伺服器吐出 HTML 錯誤頁面
    return res.status(500).json({ error: "圖片可能太大或伺服器忙碌中" });
  }
}
