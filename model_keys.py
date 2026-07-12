# -*- coding: utf-8 -*-
"""UNetキー名の分類ヘルパー(単体で完結。他パッケージに依存しない)。

ブロック名 / 要素 / サブ要素への分類。マージ経験則の6要素グルーピングと同じ。
"""

# ブロック×要素マトリクスの列
MATRIX_ELEMENTS = ("attn1", "attn2", "ff", "norm", "proj", "other")


def block_label(key_unet):
    """UNetキー名(diffusion_model.プレフィックス除去済み)をブロック名にする。"""
    parts = key_unet.split(".")
    try:
        if parts[0] == "input_blocks":
            return "IN%02d" % int(parts[1])
        if parts[0] == "middle_block":
            return "M00"
        if parts[0] == "output_blocks":
            return "OUT%02d" % int(parts[1])
    except (IndexError, ValueError):
        pass
    return "BASE"  # time_embed, label_emb, out. など


def classify_element(key_unet):
    """UNetキーを MATRIX_ELEMENTS の6グループのどれかに分類する。"""
    segs = key_unet.split(".")
    if "attn1" in segs:
        return "attn1"
    if "attn2" in segs:
        return "attn2"
    if "ff" in segs:
        return "ff"
    if "proj_in" in segs or "proj_out" in segs:
        return "proj"
    if any(s.startswith("norm") for s in segs):
        return "norm"
    return "other"


def classify_sub(key_unet):
    """要素内のサブ要素の短いラベルを返す(JS側の SUB 列と一致)。該当なしは None。"""
    segs = key_unet.split(".")
    elem = classify_element(key_unet)
    if elem in ("attn1", "attn2"):
        for s in ("to_q", "to_k", "to_v", "to_out"):
            if s in segs:
                return s
        return None
    if elem == "ff":
        if "net" in segs:
            i = segs.index("net")
            if i + 1 < len(segs):
                if segs[i + 1] == "0":
                    return "net.0"
                if segs[i + 1] == "2":
                    return "net.2"
        return None
    if elem == "norm":
        for s in ("norm1", "norm2", "norm3"):
            if s in segs:
                return s
        return None
    if elem == "proj":
        if "proj_in" in segs:
            return "proj_in"
        if "proj_out" in segs:
            return "proj_out"
        return None
    for s in ("in_layers", "out_layers", "emb_layers", "skip_connection"):
        if s in segs:
            return s
    if any(x.startswith("conv") for x in segs):
        return "conv"
    return None
