// Model Diff Viewer (Heatmap) — 2つのSDXLモデルの差分をブロック×要素で色表示
// ノード実行時にPython側から届く heatmap(JSON) を読んでセルを着色する。
// タブ: ALL=6要素 / attn1〜other=その要素のサブ要素まで掘る。
// レイアウトはMBW風(IN左 / OUT右 / BASE・M00下段)。読み取り専用。SDXL専用。
import { app } from "../../scripts/app.js";

// SDXL: input/output は 0..8 のみ
const IN_BLOCKS = [];
const OUT_BLOCKS = [];
for (let i = 0; i < 9; i++) {
  IN_BLOCKS.push("IN" + String(i).padStart(2, "0"));
  OUT_BLOCKS.push("OUT" + String(i).padStart(2, "0"));
}
const MID_BLOCKS = ["BASE", "M00"];
const ALL_BLOCKS = [...IN_BLOCKS, ...OUT_BLOCKS, ...MID_BLOCKS];
const ELEMENTS = ["attn1", "attn2", "ff", "norm", "proj", "other"];
const TABS = ["ALL", ...ELEMENTS];
const SUB = {
  attn1: ["to_q", "to_k", "to_v", "to_out"],
  attn2: ["to_q", "to_k", "to_v", "to_out"],
  ff: ["net.0", "net.2"],
  norm: ["norm1", "norm2", "norm3"],
  proj: ["proj_in", "proj_out"],
  other: ["in_layers", "out_layers", "emb_layers", "skip_connection", "conv"],
};

const CSS = `
.gg-diff {
  font-family: "Segoe UI", sans-serif;
  background: linear-gradient(180deg, #2b2d35 0%, #1f2026 100%);
  border: 1px solid #15161b; border-radius: 6px; padding: 8px;
  user-select: none; color: #c9cdd8;
}
.gg-diff-tabs { display: flex; gap: 2px; margin-bottom: 4px; }
.gg-diff-tab {
  flex: 1; text-align: center; padding: 3px 0; cursor: pointer;
  font-size: 10px; font-weight: 600; color: #99a;
  background: #2c2f3a; border: 1px solid #23252e; border-radius: 3px;
}
.gg-diff-tab:hover { color: #dde; }
.gg-diff-tab.gg-active {
  background: linear-gradient(180deg, #6a7080, #4a4f5e); color: #f5e04a;
}
.gg-diff-cols { display: flex; gap: 10px; justify-content: center; }
.gg-diff-mid { display: flex; justify-content: center; margin-top: 2px; }
.gg-diff table { border-collapse: collapse; }
.gg-diff th {
  font-size: 8px; font-weight: 600; color: #e8d44d;
  padding: 1px 2px; text-shadow: 0 1px 1px #000;
}
.gg-diff td.gg-diff-lbl {
  font-size: 9px; color: #aab; text-align: right;
  padding: 0 4px 0 0; min-width: 30px;
}
.gg-diff td.gg-diff-lbl-r { text-align: left; padding: 0 0 0 4px; }
.gg-diff td { padding: 1px; }
.gg-diff-cell {
  width: 30px; height: 16px; border-radius: 2px;
  font-size: 8px; line-height: 16px; text-align: center;
  color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,.8);
  background: #20222a; border: 1px solid #15161b;
}
.gg-diff-cell.gg-diff-empty { color: #4a4d57; }
.gg-diff-info {
  margin-top: 5px; padding: 3px 8px; background: #1b2027;
  border: 1px solid #0d0f13; border-radius: 3px;
  font-size: 11px; color: #b8e08a; min-height: 15px;
  font-family: Consolas, monospace;
}
.gg-diff-bottom {
  display: flex; align-items: center; gap: 8px;
  font-size: 9px; color: #99a; margin-top: 4px; justify-content: center;
}
.gg-diff-bar {
  width: 110px; height: 8px; border-radius: 2px;
  background: linear-gradient(90deg, #263042, #d9a441, #ff3b30);
}
.gg-diff-png {
  font-size: 10px; padding: 1px 8px; cursor: pointer;
  background: linear-gradient(180deg, #5a6070, #3a3e4b);
  color: #dde; border: 1px solid #23252e; border-radius: 3px;
}
.gg-diff-png:hover { color: #f5e04a; }
`;

function injectCSS() {
  if (document.getElementById("gg-diff-css")) return;
  const s = document.createElement("style");
  s.id = "gg-diff-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

function heatColor(v) {
  v = Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  let r, g, b;
  if (v < 0.5) {
    const t = v / 0.5;
    r = lerp(0x26, 0xd9, t); g = lerp(0x30, 0xa4, t); b = lerp(0x42, 0x41, t);
  } else {
    const t = (v - 0.5) / 0.5;
    r = lerp(0xd9, 0xff, t); g = lerp(0xa4, 0x3b, t); b = lerp(0x41, 0x30, t);
  }
  return `rgb(${r},${g},${b})`;
}

app.registerExtension({
  name: "galigali.recipemerge.diff_viewer",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "ModelDiffViewer"
        && nodeData.name !== "ModelAblationAnalyzer") return;
    const isAblation = nodeData.name === "ModelAblationAnalyzer";

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      injectCSS();

      const root = document.createElement("div");
      root.className = "gg-diff";
      root.addEventListener("pointerdown", (e) => e.stopPropagation());

      const tabbar = document.createElement("div");
      tabbar.className = "gg-diff-tabs";
      root.appendChild(tabbar);

      const content = document.createElement("div");
      root.appendChild(content);

      const bottom = document.createElement("div");
      bottom.className = "gg-diff-bottom";
      const bar = document.createElement("div");
      bar.className = "gg-diff-bar";
      const pngBtn = document.createElement("button");
      pngBtn.className = "gg-diff-png";
      pngBtn.textContent = "PNG保存";
      bottom.appendChild(document.createTextNode("same 0"));
      bottom.appendChild(bar);
      bottom.appendChild(document.createTextNode("1 diff"));
      bottom.appendChild(pngBtn);
      root.appendChild(bottom);

      const info = document.createElement("div");
      info.className = "gg-diff-info";
      info.textContent = isAblation
        ? "実行するとブロック重要度ヒートマップが出ます (SDXL専用)"
        : "実行すると2モデルの差分ヒートマップが出ます (SDXL専用)";
      root.appendChild(info);

      let lastData = null;   // 直近のペイロード(タブ切替で再描画)
      let activeTab = "ALL";
      let cells = {};        // "block|col" -> cell div

      const valueOf = (block, col) => {
        if (!lastData) return null;
        if (activeTab === "ALL") {
          const m = lastData.matrix || {};
          return (m[block] && typeof m[block][col] === "number")
            ? m[block][col] : null;
        }
        const sm = lastData.sub_matrix || {};
        const e = (sm[block] && sm[block][activeTab]) || null;
        return (e && typeof e[col] === "number") ? e[col] : null;
      };

      const applyColors = () => {
        for (const key of Object.keys(cells)) {
          const [block, col] = key.split("|");
          const c = cells[key];
          const v = valueOf(block, col);
          c._val = v;
          if (v == null) {
            c.style.background = "#20222a";
            c.className = "gg-diff-cell gg-diff-empty";
            c.textContent = "·";
          } else {
            c.style.background = heatColor(v);
            c.className = "gg-diff-cell";
            c.textContent = v >= 0.995 ? "1" : v.toFixed(2).slice(1);
          }
        }
      };

      const mkCell = (block, col) => {
        const c = document.createElement("div");
        c.className = "gg-diff-cell gg-diff-empty";
        c.textContent = "·";
        c._val = null;
        c.addEventListener("pointerenter", () => {
          info.textContent = (c._val == null)
            ? block + " : " + col + " = (no data)"
            : block + " : " + col + " = " + c._val.toFixed(3);
        });
        cells[block + "|" + col] = c;
        return c;
      };

      const mkTable = (blocks, labelRight, cols) => {
        const table = document.createElement("table");
        const head = table.insertRow();
        if (!labelRight) head.appendChild(document.createElement("th"));
        for (const col of cols) {
          const th = document.createElement("th");
          th.textContent = col;
          head.appendChild(th);
        }
        if (labelRight) head.appendChild(document.createElement("th"));
        for (const b of blocks) {
          const tr = table.insertRow();
          const addLabel = () => {
            const td = tr.insertCell();
            td.className = labelRight ? "gg-diff-lbl gg-diff-lbl-r"
                                      : "gg-diff-lbl";
            td.textContent = b;
          };
          if (!labelRight) addLabel();
          for (const col of cols) tr.insertCell().appendChild(mkCell(b, col));
          if (labelRight) addLabel();
        }
        return table;
      };

      const buildContent = () => {
        cells = {};
        content.innerHTML = "";
        const cols = activeTab === "ALL" ? ELEMENTS : SUB[activeTab];
        const wrap = document.createElement("div");
        wrap.className = "gg-diff-cols";
        wrap.appendChild(mkTable(IN_BLOCKS, false, cols));
        wrap.appendChild(mkTable(OUT_BLOCKS, true, cols));
        content.appendChild(wrap);
        const mid = document.createElement("div");
        mid.className = "gg-diff-mid";
        mid.appendChild(mkTable(MID_BLOCKS, false, cols));
        content.appendChild(mid);
        applyColors();
      };

      const tabEls = {};
      for (const t of TABS) {
        const tab = document.createElement("div");
        tab.className = "gg-diff-tab" + (t === activeTab ? " gg-active" : "");
        tab.textContent = t;
        tab.addEventListener("click", (e) => {
          e.stopPropagation();
          activeTab = t;
          for (const k of Object.keys(tabEls))
            tabEls[k].classList.toggle("gg-active", k === t);
          buildContent();
        });
        tabEls[t] = tab;
        tabbar.appendChild(tab);
      }

      // Python側から届いたペイロードで着色
      this._ggPaint = (payload) => {
        try { lastData = JSON.parse(payload); } catch (e) { return; }
        applyColors();
        const gm = (typeof lastData.global_mean === "number")
          ? lastData.global_mean.toFixed(4) : "?";
        const isAbl = lastData.kind === "ablation";
        info.textContent = "[" + (lastData.metric || "?") + "] "
          + (isAbl ? "平均重要度: " : "全体平均差分: ") + gm + "  /  "
          + (isAbl ? "測定グループ数: " : "比較キー数: ")
          + (lastData.n_keys ?? "?");
      };

      // ヒートマップをPNGで保存(DOM→SVG foreignObject→canvas)
      pngBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const w = root.offsetWidth || 560;
        const h = root.offsetHeight || 520;
        const clone = root.cloneNode(true);
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
          `<foreignObject width="100%" height="100%">` +
          `<div xmlns="http://www.w3.org/1999/xhtml"><style>${CSS}</style>` +
          clone.outerHTML + `</div></foreignObject></svg>`;
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#1f2026";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0);
          const a = document.createElement("a");
          a.href = cv.toDataURL("image/png");
          a.download = "model_diff_heatmap.png";
          a.click();
        };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      });

      buildContent();

      this.addDOMWidget("diff_ui", "gg_diff_ui", root, {
        serialize: false,
        getMinHeight: () => 470,
      });
      this.size = [Math.max(this.size[0], 560),
                   Math.max(this.size[1], 500)];
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      const payload = message?.heatmap?.[0];
      if (payload) this._ggPaint?.(payload);
    };
  },
});
