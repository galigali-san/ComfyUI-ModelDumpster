// ComfyUI Session Stats Extension
// Tracks generation count, average time, and model usage in a resident dashboard.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// --- i18n Localization Configuration ---
const i18n = {
  ja: {
    title: "セッション生成統計",
    showDashboard: "生成統計ダッシュボードを表示",
    close: "閉じる",
    countVal: "生成枚数",
    avgTime: "平均時間",
    totalTime: "累積時間",
    modelRatio: "使用モデル割合",
    monitoring: "バックグラウンド監視中",
    generating: "生成中...",
    generatingNode: "生成中... (ノード: {nodeId})",
    interrupted: "中断されました",
    error: "エラーが発生しました",
    resetBtn: "統計リセット",
    resetConfirm: "統計データをすべてリセットしますか？この操作は取り消せません。",
    noData: "まだ統計データがありません",
    countSuffix: " 回"
  },
  de: {
    title: "Generierungsstatistik",
    showDashboard: "Generierungsstatistik-Dashboard anzeigen",
    close: "Schließen",
    countVal: "Generiert",
    avgTime: "Ø Dauer",
    totalTime: "Gesamtzeit",
    modelRatio: "Modellnutzung",
    monitoring: "Hintergrund-Monitoring",
    generating: "Generiere...",
    generatingNode: "Generiere... (Knoten: {nodeId})",
    interrupted: "Abgebrochen",
    error: "Fehler aufgetreten",
    resetBtn: "Zurücksetzen",
    resetConfirm: "Möchten Sie alle Statistikdaten zurücksetzen? Diese Aktion kann nicht rückgängig gemacht werden.",
    noData: "Noch keine Statistikdaten vorhanden",
    countSuffix: " Mal"
  },
  en: {
    title: "Session Stats",
    showDashboard: "Show Generation Stats Dashboard",
    close: "Close",
    countVal: "Generated",
    avgTime: "Avg Duration",
    totalTime: "Total Time",
    modelRatio: "Model Popularity",
    monitoring: "Monitoring in background",
    generating: "Generating...",
    generatingNode: "Generating... (Node: {nodeId})",
    interrupted: "Interrupted",
    error: "Error occurred",
    resetBtn: "Reset Stats",
    resetConfirm: "Do you want to reset all statistical data? This action cannot be undone.",
    noData: "No statistical data available yet",
    countSuffix: " times"
  }
};

// Detect browser language and fallback to English if not supported
const langCode = (navigator.language || 'en').split('-')[0].toLowerCase();
const t = i18n[langCode] || i18n.en;

function getTranslation(key, params = {}) {
  let text = t[key] || i18n.en[key] || "";
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}

// --- CSS Styles Injection ---
const CSS = `
.comfy-stats-btn {
  position: fixed;
  bottom: 20px;
  left: 20px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
  border: 2px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4), 0 0 10px rgba(139, 92, 246, 0.3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s ease;
}
.comfy-stats-btn:hover {
  transform: scale(1.08) translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5), 0 0 15px rgba(139, 92, 246, 0.5);
}
.comfy-stats-btn:active {
  transform: scale(0.95);
}
.comfy-stats-btn svg {
  width: 22px;
  height: 22px;
  fill: #ffffff;
}

.comfy-stats-panel {
  position: fixed;
  bottom: 80px;
  left: 20px;
  width: 340px;
  background: rgba(19, 27, 46, 0.85);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  color: #f3f4f6;
  font-family: 'Outfit', 'Segoe UI', sans-serif;
  z-index: 9998;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  opacity: 0;
  transform: translateY(20px) scale(0.95);
  pointer-events: none;
  transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.comfy-stats-panel.active {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: all;
}

.comfy-stats-header {
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.comfy-stats-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
  background: linear-gradient(90deg, #a78bfa 0%, #60a5fa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: flex;
  align-items: center;
  gap: 6px;
}
.comfy-stats-close {
  background: transparent;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  transition: background 0.2s, color 0.2s;
}
.comfy-stats-close:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.comfy-stats-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 420px;
  overflow-y: auto;
}

.comfy-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.comfy-stats-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 10px 8px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.comfy-stats-val {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
  font-family: monospace;
}
.comfy-stats-label {
  font-size: 9px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.comfy-stats-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.comfy-stats-sec-title {
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding-bottom: 4px;
}

.comfy-stats-models {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 180px;
  overflow-y: auto;
  padding-right: 4px;
}
.comfy-stats-model-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.comfy-stats-model-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}
.comfy-stats-model-name {
  color: #e5e7eb;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}
.comfy-stats-model-count {
  font-weight: 600;
  color: #60a5fa;
}
.comfy-stats-bar-bg {
  height: 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  overflow: hidden;
}
.comfy-stats-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #8b5cf6 0%, #3b82f6 100%);
  border-radius: 3px;
  width: 0%;
  transition: width 0.4s ease;
}

.comfy-stats-footer {
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.comfy-stats-status {
  font-size: 10px;
  color: #6b7280;
}
.comfy-stats-reset {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #ef4444;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 10px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}
.comfy-stats-reset:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.4);
}
`;

function injectCSS() {
  if (document.getElementById("comfy-stats-css")) return;
  const style = document.createElement("style");
  style.id = "comfy-stats-css";
  style.textContent = CSS;
  document.head.appendChild(style);
}

// --- Application Logic ---

// FIFO queue to store model names submitted in execution
const submittedModelsQueue = [];
let activeExecution = null; // { promptId, startTime, models }

// Core Stats State
let stats = {
  count: 0,
  totalTime: 0,
  models: {} // { "model_name": count }
};

// Load Stats from LocalStorage
function loadStats() {
  const saved = localStorage.getItem("comfyui_generation_stats");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (typeof parsed.count === 'number') stats.count = parsed.count;
      if (typeof parsed.totalTime === 'number') stats.totalTime = parsed.totalTime;
      if (parsed.models && typeof parsed.models === 'object') stats.models = parsed.models;
    } catch (e) {
      console.error("Failed to parse ComfyUI generation stats:", e);
    }
  }
}

// Save Stats to LocalStorage
function saveStats() {
  localStorage.setItem("comfyui_generation_stats", JSON.stringify(stats));
}

// Calculate averages
function getAvgTime() {
  if (stats.count === 0) return 0;
  return stats.totalTime / stats.count;
}

// Format duration
function formatTime(secs) {
  if (secs < 60) {
    return `${secs.toFixed(1)}s`;
  }
  const mins = Math.floor(secs / 60);
  const remSecs = Math.floor(secs % 60);
  return `${mins}m ${remSecs}s`;
}

// Create DOM Interface
let panelEl = null;
let toggleBtnEl = null;

function createUI() {
  injectCSS();
  
  // Create Toggle Button
  toggleBtnEl = document.createElement("div");
  toggleBtnEl.className = "comfy-stats-btn";
  toggleBtnEl.title = getTranslation('showDashboard');
  toggleBtnEl.innerHTML = `
    <svg viewBox="0 0 24 24">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
    </svg>
  `;
  document.body.appendChild(toggleBtnEl);
  
  // Create Collapsible Panel
  panelEl = document.createElement("div");
  panelEl.className = "comfy-stats-panel";
  panelEl.innerHTML = `
    <div class="comfy-stats-header">
      <div class="comfy-stats-title">
        <svg style="width:16px; height:16px; fill:#a78bfa;" viewBox="0 0 24 24">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
        </svg>
        ${getTranslation('title')}
      </div>
      <button class="comfy-stats-close" title="${getTranslation('close')}">&times;</button>
    </div>
    <div class="comfy-stats-body">
      <div class="comfy-stats-grid">
        <div class="comfy-stats-card">
          <div class="comfy-stats-val" id="stats-count">0</div>
          <div class="comfy-stats-label">${getTranslation('countVal')}</div>
        </div>
        <div class="comfy-stats-card">
          <div class="comfy-stats-val" id="stats-avg">0.0s</div>
          <div class="comfy-stats-label">${getTranslation('avgTime')}</div>
        </div>
        <div class="comfy-stats-card">
          <div class="comfy-stats-val" id="stats-total">0s</div>
          <div class="comfy-stats-label">${getTranslation('totalTime')}</div>
        </div>
      </div>
      
      <div class="comfy-stats-section">
        <div class="comfy-stats-sec-title">${getTranslation('modelRatio')}</div>
        <div class="comfy-stats-models" id="stats-models-list">
          <!-- Dynamically filled model usage rows -->
        </div>
      </div>
    </div>
    <div class="comfy-stats-footer">
      <span class="comfy-stats-status" id="stats-status-text">${getTranslation('monitoring')}</span>
      <button class="comfy-stats-reset" id="stats-reset-btn">${getTranslation('resetBtn')}</button>
    </div>
  `;
  document.body.appendChild(panelEl);
  
  // Event Bindings
  toggleBtnEl.addEventListener("click", togglePanel);
  panelEl.querySelector(".comfy-stats-close").addEventListener("click", hidePanel);
  panelEl.querySelector("#stats-reset-btn").addEventListener("click", confirmReset);
  
  // Prevent canvas events when interacting with the panel
  panelEl.addEventListener("pointerdown", (e) => e.stopPropagation());
  panelEl.addEventListener("wheel", (e) => e.stopPropagation());
  
  updateUI();
}

function togglePanel() {
  panelEl.classList.toggle("active");
  if (panelEl.classList.contains("active")) {
    updateUI();
  }
}

function hidePanel() {
  panelEl.classList.remove("active");
}

function updateUI() {
  if (!panelEl) return;
  
  // Update Cards
  document.getElementById("stats-count").textContent = stats.count;
  document.getElementById("stats-avg").textContent = formatTime(getAvgTime());
  document.getElementById("stats-total").textContent = formatTime(stats.totalTime);
  
  // Render Model Usage Rows
  const listEl = document.getElementById("stats-models-list");
  listEl.innerHTML = "";
  
  const sortedModels = Object.entries(stats.models).sort((a, b) => b[1] - a[1]);
  
  if (sortedModels.length === 0) {
    listEl.innerHTML = `<div style="font-size:10px; color:#6b7280; text-align:center; padding:10px 0;">${getTranslation('noData')}</div>`;
    return;
  }
  
  // Find maximum count for scaling bar width
  const maxCount = Math.max(...sortedModels.map(m => m[1]), 1);
  
  for (const [name, count] of sortedModels) {
    const percentage = (count / maxCount) * 100;
    
    // Truncate folder path from model name if present
    const baseName = name.split(/[\\/]/).pop();
    
    const row = document.createElement("div");
    row.className = "comfy-stats-model-row";
    row.innerHTML = `
      <div class="comfy-stats-model-meta">
        <span class="comfy-stats-model-name" title="${name}">${baseName}</span>
        <span class="comfy-stats-model-count">${count}${getTranslation('countSuffix')}</span>
      </div>
      <div class="comfy-stats-bar-bg">
        <div class="comfy-stats-bar-fill" style="width: ${percentage}%"></div>
      </div>
    `;
    listEl.appendChild(row);
  }
}

function confirmReset() {
  if (confirm(getTranslation('resetConfirm'))) {
    stats = {
      count: 0,
      totalTime: 0,
      models: {}
    };
    saveStats();
    updateUI();
  }
}

// --- Combined Extension Registration ---

app.registerExtension({
  name: "galigali.session.stats",
  
  // 1. Intercept prompt submission to scan for loaded checkpoint models
  beforeSubmitPrompt(prompt) {
    const models = [];
    
    try {
      for (const nodeId in prompt) {
        const node = prompt[nodeId];
        // Look for checkpoint loaders
        if (node.class_type === "CheckpointLoaderSimple" || node.class_type === "CheckpointLoader") {
          if (node.inputs && node.inputs.ckpt_name) {
            models.push(node.inputs.ckpt_name);
          }
        }
      }
    } catch (err) {
      console.error("Error parsing submitted prompt in stats extension:", err);
    }
    
    // Fallback if no model node is found
    if (models.length === 0) {
      models.push("Unknown Model");
    }
    
    submittedModelsQueue.push(models);
  },
  
  // 2. Setup stats UI and listen to WebSocket events for start and completion
  async setup() {
    loadStats();
    createUI();
    
    // Event: Generation starts
    api.addEventListener("execution_start", (event) => {
      const detail = event.detail;
      const promptId = detail ? detail.prompt_id : null;
      
      // Shift model from queue or scan active canvas graph as fallback
      let models = submittedModelsQueue.shift();
      
      if (!models) {
        models = [];
        try {
          const checkpointNodes = app.graph._nodes.filter(
            n => n.type === "CheckpointLoaderSimple" || n.type === "CheckpointLoader"
          );
          for (const node of checkpointNodes) {
            const w = node.widgets?.find(w => w.name === "ckpt_name");
            if (w && w.value) {
              models.push(w.value);
            }
          }
        } catch (e) {
          console.error("Error scanning graph on execution start:", e);
        }
        if (models.length === 0) models.push("Unknown Model");
      }
      
      activeExecution = {
        promptId,
        startTime: performance.now(),
        models
      };
      
      // Update status text on footer
      const statusText = document.getElementById("stats-status-text");
      if (statusText) statusText.textContent = getTranslation('generating');
    });
    
    // Event: Progress / Node Execution
    api.addEventListener("executing", (event) => {
      const detail = event.detail;
      
      // Handle potential formats of ComfyUI executing events:
      // Old: detail is a string (nodeId) or null (finished)
      // New: detail is an object { node: nodeId, prompt_id: promptId } where node can be null (finished)
      const isFinished = !detail || (typeof detail === 'object' && detail.node === null);
      
      if (isFinished) {
        if (activeExecution) {
          const duration = (performance.now() - activeExecution.startTime) / 1000; // in seconds
          
          // Update statistics
          stats.count += 1;
          stats.totalTime += duration;
          
          // Record model usage
          activeExecution.models.forEach(modelName => {
            stats.models[modelName] = (stats.models[modelName] || 0) + 1;
          });
          
          saveStats();
          updateUI();
          
          // Clean active execution state
          activeExecution = null;
        }
        
        const statusText = document.getElementById("stats-status-text");
        if (statusText) statusText.textContent = getTranslation('monitoring');
      } else {
        // Node is executing
        const statusText = document.getElementById("stats-status-text");
        if (statusText && activeExecution) {
          const nodeId = typeof detail === 'object' ? detail.node : detail;
          statusText.textContent = getTranslation('generatingNode', { nodeId });
        }
      }
    });
    
    // Event: Execution interrupted (Cancelled by user)
    api.addEventListener("execution_interrupted", () => {
      activeExecution = null;
      submittedModelsQueue.length = 0; // Clear queue
      
      const statusText = document.getElementById("stats-status-text");
      if (statusText) statusText.textContent = getTranslation('interrupted');
      setTimeout(() => {
        if (!activeExecution && statusText) {
          statusText.textContent = getTranslation('monitoring');
        }
      }, 3000);
    });
    
    // Event: Execution error
    api.addEventListener("execution_error", () => {
      activeExecution = null;
      submittedModelsQueue.length = 0;
      
      const statusText = document.getElementById("stats-status-text");
      if (statusText) statusText.textContent = getTranslation('error');
      setTimeout(() => {
        if (!activeExecution && statusText) {
          statusText.textContent = getTranslation('monitoring');
        }
      }, 3000);
    });
  }
});
