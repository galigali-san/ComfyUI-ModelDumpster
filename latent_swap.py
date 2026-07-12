# -*- coding: utf-8 -*-
"""EmptyLatentImageSwap Node.

標準の「空の潜在画像」(EmptyLatentImage) ノードをベースに、
ワンクリックで幅と高さを入れ替えられる「Swap」ボタンを追加した独自のカスタムノードです。
"""

from nodes import EmptyLatentImage

class EmptyLatentImageSwap(EmptyLatentImage):
    """標準のEmptyLatentImageを継承し、JavaScriptでSwapボタンを追加するためのノード定義。"""
    
    # ノードホバー時に表示される説明文
    DESCRIPTION = (
        "Creates a new batch of empty latent images to be denoised via sampling. "
        "Includes a 'Swap (縦横入替)' button to quickly exchange the width and height values.\n"
        "(サンプリング用に空の潜在画像を生成します。幅と高さの数値をワンクリックで入れ替えられる『Swap』ボタン付き。)"
    )
    
    # 検索で見つかりやすいようにエイリアスを追加
    SEARCH_ALIASES = ["empty", "empty latent", "swap width height", "swap size", "orientation", "縦横入れ替え", "空の潜在画像"]
