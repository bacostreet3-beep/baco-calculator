const { GoogleGenerativeAI } = require("@google/generative-ai");
const formidable = require('formidable');
const fs = require('fs');

export const config = {
  api: {
    bodyParser: false,
  },
};

// 使用 Gemini 2.5 Flash 模型 (穩定且快速)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const form = formidable({ keepExtensions: true });

  try {
    const [fields, files] = await form.parse(req);

    // 準備給 AI 的內容陣列
    let parts = [];

    // 1. 處理文字輸入
    if (fields.text && fields.text[0]) {
      parts.push(fields.text[0]);
    }

    // 2. 處理圖片 (這是修正的關鍵！)
    if (files.image) {
      // 判斷：如果是多張圖片(陣列)，就直接用；如果是單張(物件)，就包成陣列
      const imageFiles = Array.isArray(files.image) ? files.image : [files.image];

      // 迴圈處理每一張圖片
      for (const file of imageFiles) {
        const imageData = fs.readFileSync(file.filepath).toString("base64");
        parts.push({
          inlineData: {
            data: imageData,
            mimeType: file.mimetype,
          },
        });
      }
    }

    // 3. 加入系統提示詞 (告訴 AI 要做什麼)
    const systemPrompt = `
      你是一個專業的烘焙食譜分析師。
      請分析上傳的圖片(可能有多張)或文字，提取出食譜中的「食材名稱」與「重量(克)」。
      
      規則：
      1. 如果圖片被切成多張（例如一張上半部、一張下半部），請綜合所有圖片資訊。
      2. 優先尋找重量單位為 g (公克) 的數值。如果是其他單位(lb, oz, 杯, 匙)，請盡量換算成公克。
      3. 忽略非食材項目（如器具、溫度、步驟說明）。
      4. 若有重複提到的食材，請自行判斷是否為同一項並合併，或取最合理的數值。
      5. 請務必回傳「純 JSON 陣列」，格式如下：
      
      [
        { "name": "高筋麵粉", "weight": 250 },
        { "name": "冰水", "weight": 160 },
        { "name": "速發酵母", "weight": 3 }
      ]
      
      (注意：不要回傳 markdown 標記，只要 JSON 字串)
    `;
    
    // 把提示詞放在最後面
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
        console.error("JSON Parse Error:", text);
        return res.status(500).json({ error: "AI 回傳格式無法解析" });
    }

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: "伺服器處理失敗：" + error.message });
  }
}
