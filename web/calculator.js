// Calculator — キャンバス上で完結する四則計算の電卓ノード
// 計算はJS側で行い、結果を隠しウィジェット "value" に書き込む(Queue不要)。
import { app } from "../../scripts/app.js";

const CSS = `
.gg-calc {
  font-family: "Segoe UI", sans-serif;
  background: linear-gradient(180deg, #2b2d35 0%, #1f2026 100%);
  border: 1px solid #15161b; border-radius: 6px; padding: 6px;
  user-select: none; color: #e8eaf0;
}
.gg-calc-disp {
  background: #12141a; border: 1px solid #0d0f13; border-radius: 4px;
  padding: 6px 10px; margin-bottom: 6px; text-align: right;
  font-family: Consolas, monospace; min-height: 42px;
  box-shadow: inset 0 1px 3px rgba(0,0,0,.6);
}
.gg-calc-expr { font-size: 11px; color: #8a90a0; min-height: 14px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gg-calc-out { font-size: 22px; color: #b8e08a; font-weight: 600;
  text-shadow: 0 0 5px rgba(150,220,90,.4);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gg-calc-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px;
}
.gg-calc-btn {
  padding: 10px 0; text-align: center; cursor: pointer;
  font-size: 15px; font-weight: 600; border-radius: 4px;
  background: linear-gradient(180deg, #4a4f5e, #3a3e4b);
  border: 1px solid #23252e; color: #dde;
  box-shadow: 0 1px 2px rgba(0,0,0,.4);
}
.gg-calc-btn:hover { background: linear-gradient(180deg, #565c6d, #42465400); color: #fff; }
.gg-calc-btn:active { transform: translateY(1px); }
.gg-calc-op { color: #f5b74a; }
.gg-calc-eq { background: linear-gradient(180deg, #3b82f6, #1d4ed8); color: #fff; }
.gg-calc-eq:hover { background: linear-gradient(180deg, #4b8ffc, #2560e0); }
.gg-calc-clr { color: #ff6b6b; }
`;

function injectCSS() {
  if (document.getElementById("gg-calc-css")) return;
  const s = document.createElement("style");
  s.id = "gg-calc-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ボタン列で作られた数式("2+3*4")を、四則の優先順位で安全に評価する。
// JS evalは使わず、自前のトークナイザ+2段階(先に * / 、次に + -)。
function evaluate(expr) {
  const tokens = expr.match(/(\d+\.?\d*|\.\d+|[+\-*/])/g);
  if (!tokens || tokens.length === 0) return null;
  // 末尾が演算子なら未完成 → 落とす
  while (tokens.length && /[+\-*/]/.test(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length === 0) return null;
  let nums = [parseFloat(tokens[0])];
  const ops = [];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const n = parseFloat(tokens[i + 1]);
    if (isNaN(n)) return null;
    if (op === "*") nums[nums.length - 1] *= n;
    else if (op === "/") {
      if (n === 0) return "ERR";
      nums[nums.length - 1] /= n;
    } else { ops.push(op); nums.push(n); }
  }
  let res = nums[0];
  for (let i = 0; i < ops.length; i++) {
    res = ops[i] === "+" ? res + nums[i + 1] : res - nums[i + 1];
  }
  if (!isFinite(res)) return "ERR";
  // 浮動小数のノイズを丸める
  return parseFloat(res.toFixed(10));
}

app.registerExtension({
  name: "galigali.dumpster.calculator",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "Calculator") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      injectCSS();

      const vw = this.widgets.find((w) => w.name === "value");
      vw.computeSize = () => [0, -4];
      vw.hidden = true;
      vw.type = "hidden";

      let expr = "";           // 入力中の数式
      let justEvaluated = false;

      const root = document.createElement("div");
      root.className = "gg-calc";
      root.addEventListener("pointerdown", (e) => e.stopPropagation());

      const disp = document.createElement("div");
      disp.className = "gg-calc-disp";
      const exprEl = document.createElement("div");
      exprEl.className = "gg-calc-expr";
      const outEl = document.createElement("div");
      outEl.className = "gg-calc-out";
      disp.appendChild(exprEl);
      disp.appendChild(outEl);
      root.appendChild(disp);

      const render = (result) => {
        exprEl.textContent = expr || " ";
        if (result !== undefined) outEl.textContent = result;
      };
      const setResult = (r) => {
        outEl.textContent = r;
        vw.value = String(r);   // Python出力用に保存
      };

      // 初期表示は保存済みの値(ワークフロー復元にも対応)
      setResult(vw.value || "0");
      render();

      const grid = document.createElement("div");
      grid.className = "gg-calc-grid";
      root.appendChild(grid);

      const press = (key) => {
        if (key === "C") { expr = ""; render(); setResult("0"); return; }
        if (key === "back") { expr = expr.slice(0, -1); render(); return; }
        if (key === "=") {
          const r = evaluate(expr);
          if (r === null) return;
          if (r === "ERR") { setResult("Error"); return; }
          setResult(r);
          expr = String(r);     // 続けて計算できるように結果を残す
          justEvaluated = true;
          return;
        }
        const isOp = /[+\-*/]/.test(key);
        if (justEvaluated && !isOp) { expr = ""; }  // = 直後に数字なら新規入力
        justEvaluated = false;
        // 演算子の連続はあとの方で上書き
        if (isOp && /[+\-*/]$/.test(expr)) expr = expr.slice(0, -1);
        if (key === "." ) {
          // 現在の数の中に既に . があれば無視
          const tail = expr.split(/[+\-*/]/).pop();
          if (tail.includes(".")) return;
          if (tail === "") expr += "0";
        }
        expr += key;
        render();
      };

      const layout = [
        ["C", "clr"], ["back", "op"], ["/", "op"], ["*", "op"],
        ["7", ""], ["8", ""], ["9", ""], ["-", "op"],
        ["4", ""], ["5", ""], ["6", ""], ["+", "op"],
        ["1", ""], ["2", ""], ["3", ""], ["=", "eq"],
        ["0", ""], ["00", ""], [".", ""],
      ];
      const labelOf = (k) => k === "back" ? "⌫" : k === "*" ? "×"
        : k === "/" ? "÷" : k === "-" ? "−" : k;
      for (const [key, kind] of layout) {
        const b = document.createElement("div");
        b.className = "gg-calc-btn"
          + (kind === "op" ? " gg-calc-op" : "")
          + (kind === "eq" ? " gg-calc-eq" : "")
          + (kind === "clr" ? " gg-calc-clr" : "");
        if (key === "=") b.style.gridRow = "span 2";
        b.textContent = labelOf(key);
        b.addEventListener("click", (e) => { e.stopPropagation(); press(key); });
        grid.appendChild(b);
      }

      // 中身の実高さを測ってノードに反映(はみ出し防止)。
      // rAF後に測る(この時点ではまだレイアウト前のことがある)
      const fit = () => {
        const h = Math.max(root.scrollHeight + 8, 300);
        this._calcMinH = h;
        const cs = this.computeSize();
        this.setSize([Math.max(this.size[0], cs[0], 250), cs[1]]);
        app.graph?.setDirtyCanvas(true, true);
      };
      this.addDOMWidget("calc_ui", "gg_calc_ui", root, {
        serialize: false,
        getMinHeight: () => this._calcMinH || 310,
      });
      this.size = [Math.max(this.size[0], 250), Math.max(this.size[1], 320)];
      requestAnimationFrame(fit);
    };

    // ワークフロー復元時、保存された結果を表示に戻す
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      onConfigure?.apply(this, arguments);
      const vw = this.widgets?.find((w) => w.name === "value");
      const out = this.domWidgets?.[0]?.element?.querySelector?.(".gg-calc-out")
        || document.querySelector(".gg-calc-out");
      if (vw && out) out.textContent = vw.value;
    };
  },
});
