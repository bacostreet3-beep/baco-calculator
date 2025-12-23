import { GoogleGenerativeAI } from "@google/generative-ai";
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = formidable();
    const [fields, files] = await form.parse(req);
    
    // 取得文字或圖片
    const textInput = fields.text ? fields.text[0] : '';
    const file = files.image ? files.image[0] : null;

    // 設定 Google AI
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-002" });

    let prompt = `
      你是專業烘焙助手。請分析提供的食譜內容（文字或圖片）。
      任務：提取食材名稱(name)與重量(weight)。
      
      規則：
      1. 若只有比例沒有重量，weight 填 null。
      2. 若單位不是公克，請自動換算成公克(g)。
      3. 若辨識不清或不確定，name 標記為 "(辨識不清)"。
      4. 只回傳純 JSON 陣列格式：[{ "name": "麵粉", "weight": 100 }, ...]
      5. 不要包含任何 Markdown 標記 (如 \`\`\`json)。
    `;

    let result;
    if (file) {
      const imageData = fs.readFileSync(file.filepath);
      const imageBase64 = imageData.toString('base64');
      const parts = [
        { text: prompt },
        { inlineData: { mimeType: file.mimetype, data: imageBase64 } }
      ];
      if(textInput) parts.push({ text: `額外補充文字：${textInput}`});
      
      result = await model.generateContent(parts);
    } else {
      result = await model.generateContent([prompt, textInput]);
    }

    const responseText = result.response.text().replace(/```json|```/g, '').trim();
    const data = JSON.parse(responseText);
    
    res.status(200).json({ data });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'AI 辨識失敗，請稍後再試' });
  }
}
