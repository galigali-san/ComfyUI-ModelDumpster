# -*- coding: utf-8 -*-
"""Calculator ノード — キャンバス上で完結する四則計算の電卓。

計算はすべてJS側(web/calculator.js)で行い、結果を隠しウィジェット
"value" に書き込む。Queueしなくても電卓として使える(スタンドアロン)。
グラフに繋ぎたいときは、その結果を result(FLOAT)/ display(STRING) で取り出せる。
"""


class Calculator:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # JSの電卓UIが計算結果(数値文字列)をここに書き込む。
                # UIが無い環境では手で数式や数値を入れてもよい。
                "value": ("STRING", {"default": "0", "multiline": False}),
            }
        }

    RETURN_TYPES = ("FLOAT", "STRING")
    RETURN_NAMES = ("result", "display")
    FUNCTION = "calc"
    CATEGORY = "utils"
    DESCRIPTION = (u"キャンバス上で完結する四則計算(+−×÷)の電卓。"
                   u"ボタンを押すだけで計算でき(Queue不要)、結果を"
                   u"result(FLOAT)/display(STRING)としてグラフにも出せる。")

    def calc(self, value):
        try:
            r = float(value)
        except (ValueError, TypeError):
            r = 0.0
        return (r, str(value))
