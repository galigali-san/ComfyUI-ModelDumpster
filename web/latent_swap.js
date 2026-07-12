import { app } from "../../../scripts/app.js";

// EmptyLatentImageSwapノードのUIを拡張し、Swapボタンを設置する拡張機能
app.registerExtension({
    name: "Comfy.EmptyLatentImageSwap",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // 自作ノードの登録名「EmptyLatentImageSwap」にマッチした時だけ処理する
        if (nodeData.name === "EmptyLatentImageSwap") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) {
                    onNodeCreated.apply(this, arguments);
                }

                // 「Swap (縦横入替)」ボタンを追加
                this.addWidget(
                    "button",
                    "Swap (縦横入替)",
                    null,
                    () => {
                        // 幅と高さのウィジェットを名前で探索
                        const widthWidget = this.widgets.find(w => w.name === "width");
                        const heightWidget = this.widgets.find(w => w.name === "height");

                        if (widthWidget && heightWidget) {
                            // 値を入れ替え
                            const temp = widthWidget.value;
                            widthWidget.value = heightWidget.value;
                            heightWidget.value = temp;

                            // 変更があったことをComfyUIのグラフシステムに通知
                            if (this.triggerSlotElement) {
                                this.triggerSlotElement();
                            }
                            app.graph.setDirtyCanvas(true, true);
                        }
                    },
                    { serialize: false } // ボタン自体の値はシリアライズ（保存）しない
                );
            };
        }
    }
});
