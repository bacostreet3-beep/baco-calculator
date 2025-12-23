import { GoogleGenerativeAI } from "@google/generative-ai";
import formidable from 'formidable';
import fs from 'fs';

// 必須設定，告訴 Next.js 不要自己解析 Body，交給 formidable 處理
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. 設定 Formidable (支援 Vercel 暫存路徑)
    const form = formidable({
      keepExtensions: true, // 保留副檔名，幫助 AI 判斷格式
      allowEmptyFiles: false,
      minFileSize: 0,
    });

    // 2. 解析 Form Data (相容 Formidable v3 Promise 寫法)
    // 注意：如果您的 formidable 版本低於 v3，這裡會報錯。
    // 請確保 package.json 中 "formidable": "^3.0.0" 或更高
    let fields, files;
    try {
      [fields, files] = await form.parse(req);
    } catch (parseError) {
      console.error("Form parsing error:", parseError);
      return res.status(400).json({ error: '檔案上傳解析失敗' });
    }

    // 3. 安全地取得資料
    // formidable v3 的欄位通常是陣列，例如 fields.text = ['內容']
    const rawText = fields.text ? fields.text[0] : '';
    const rawFile = files.image ? files.image[0] : null;

    // 4. 設定 Google AI
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    // 使用 JSON 模式 (responseMimeType) 能夠大幅降低解析失敗率
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" } 
    });

    const prompt = `
      你是專業烘焙助手。請分析提供的食譜內容（文字或圖片）。
      任務：提取食材名稱(name)與重量(weight)。
      
      規則：
      1. 若只有比例沒有重量，weight 填 null (不要填 0)。
      2. 若單位不是公克，請自動換算成公克(g)。
      3. 若辨識不清，name 標記為 "(辨識不清)"。
      4. 只回傳純 JSON 陣列格式：[{ "name": "麵粉", "weight": 100 }, ...]
      5. 不要包含任何其他對話文字。
    `;

    // 5. 準備傳送給 AI 的資料
    let parts = [{ text: prompt }];

    // 處理圖片
    if (rawFile) {
      // 確保讀取到正確的路徑 (v3 使用 filepath, v2 使用 path)
      const filePath = rawFile.filepath || rawFile.path;
      if (filePath) {
        const imageData = fs.readFileSync(filePath);
        const imageBase64 = imageData.toString('base64');
        parts.push({
          inlineData: {
            mimeType: rawFile.mimetype || 'image/jpeg',
            data: imageBase64
          }
        });
      }
    }

    // 處理文字 (只有當文字存在時才加入，避免空字串錯誤)
    if (rawText && rawText.trim() !== '') {
      parts.push({ text: `額外補充食譜文字：${rawText}` });
    }

    // 6. 呼叫 AI
    const result = await model.generateContent(parts);
    const responseText = result.response.text();

    console.log("AI Response:", responseText); // 在 Vercel 後台可查看 Log

    // 7. 解析 JSON
    let data;
    try {
      // 因為開啟了 JSON Mode，AI 回傳的通常已經是乾淨的 JSON，但為了保險還是做個簡單處理
      const cleanJson = responseText.replace(/```json|```/g, '').trim();
      data = JSON.parse(cleanJson);
    } catch (jsonError) {
      console.error("JSON Parse Error:", jsonError, "Raw:", responseText);
      return res.status(500).json({ error: 'AI 回傳格式錯誤，無法解析' });
    }
    
    // 成功回傳
    res.status(200).json({ data });

  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: '伺服器內部錯誤：' + (error.message || '未知錯誤') });
  }
}
