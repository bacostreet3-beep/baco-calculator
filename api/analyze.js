// --- 這裡保留你原本的 ingredients 資料結構 ---
    let ingredients = [
        { id: 1, name: '麵粉', weight: 100, realPct: 58.5, bakerPct: 100, isBase: true },
        { id: 2, name: '水', weight: 70, realPct: 40.9, bakerPct: 70, isBase: false },
        { id: 3, name: '酵母', weight: 1, realPct: 0.6, bakerPct: 1, isBase: false }
    ];
    let nextId = 4;
    let currentMode = 'weight'; 
    let isRenderDecimal = false;

    // ... (中間的 helpTexts 和其他 UI 函式不用動，可以保留) ...
    // ... (為了篇幅，這裡省略中間 showHelp, setMode, buildTableStructure 等 UI 顯示函式，請保留你原本的) ...

    // ========== 請務必更新以下這區塊 (AI 處理核心) ==========

    // 1. 新增這個工具函式：把圖片轉成 Base64
    const toBase64 = file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });

    // 2. 更新後的 processAI 函式
    async function processAI(e) {
        if (e && typeof e.preventDefault === 'function') {
            e.preventDefault();
        }

        const statusBar = document.getElementById('ai-status-bar');
        const btn = document.getElementById('ai-trigger-btn');
        const textInput = document.getElementById('ai-text-input');
        const fileInput = document.getElementById('ai-image-input');

        if (btn) btn.disabled = true;
        if (statusBar) {
            statusBar.innerText = "⏳ 正在分析食譜中，請稍候...";
            statusBar.style.color = "var(--text-light)";
        }

        try {
            const text = textInput ? textInput.value : "";
            const file = (fileInput && fileInput.files) ? fileInput.files[0] : null;

            if (!text && !file) {
                throw new Error("請輸入文字或選擇圖片！");
            }

            // 準備傳送的資料 (JSON 格式)
            let payload = { text: text };
            
            // 如果有圖片，先轉成 Base64 字串
            if (file) {
                if (file.size > 8 * 1024 * 1024) { // 簡單檢查是否超過 8MB
                    throw new Error("圖片太大囉，請使用小於 8MB 的圖片");
                }
                payload.image = await toBase64(file);
            }

            // 發送請求
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json' // 告訴後端這是 JSON
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.ok) {
                let rawData = data.data || []; // 根據新的後端格式讀取 data 欄位
                
                if (rawData.length > 0) {
                     // 清空舊資料，換成 AI 的資料
                     ingredients = rawData.map((item, idx) => ({
                         id: (typeof nextId !== 'undefined' ? nextId++ : Date.now() + idx), 
                         name: item.name || '未知食材', 
                         weight: Number(item.weight) || 0, 
                         realPct: 0, 
                         bakerPct: 0, 
                         isBase: idx === 0 
                     }));

                     if (typeof setMode === 'function') {
                         setMode('weight'); 
                     }

                     if (statusBar) {
                         statusBar.innerText = "✅ 分析完成！資料已填入表格";
                         statusBar.style.color = "var(--success-green)"; 
                     }
                } else {
                    throw new Error("AI 無法辨識出任何食材，請試試看更清晰的照片");
                }
            } else {
                throw new Error(data.error || "伺服器錯誤");
            }

        } catch (err) {
            console.error(err);
            if (statusBar) {
                statusBar.innerText = "❌ 發生錯誤：" + err.message;
                statusBar.style.color = "var(--error-red)";
            }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ... (保留原本的 initDragAndDrop, initWakeLock, handleFileSelect 等函式) ...

    // 確保按鈕綁定
    document.addEventListener('DOMContentLoaded', function() {
       // ... (保留你原本的 DOMContentLoaded 內容) ...
       const btn = document.getElementById('ai-trigger-btn');
       if (btn) btn.addEventListener('click', processAI);
    });
