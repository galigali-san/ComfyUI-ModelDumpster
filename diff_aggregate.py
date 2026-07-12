# -*- coding: utf-8 -*-
"""モデル差分の集計とレシピ変換(ComfyUI/torch非依存の純粋ロジック)。

per-keyの差分値をブロック×要素(+サブ要素)のマトリクスに畳み込み、
さらに差分から自動マージレシピを生成する。
テンソル計算は __init__.py 側、ここは数値の集計だけ。
"""

from .model_keys import (block_label, classify_element, classify_sub,
                         MATRIX_ELEMENTS)

# SDXL専用: input/output は 0..8 のみ(SD1.5の09〜11は無い)
BLOCKS_ORDER = (["BASE"]
                + ["IN%02d" % i for i in range(9)]
                + ["M00"]
                + ["OUT%02d" % i for i in range(9)])

# レシピの要素トークンに変換できるもの(otherは構造部なので対象外)
_ELEM_TO_RECIPE = {
    "attn1": ["attn1"],
    "attn2": ["attn2"],
    "ff": ["ff"],
    "norm": ["norm"],
    "proj": ["proj_in", "proj_out"],
}


def aggregate_diffs(items):
    """per-key差分をブロック×要素(+サブ要素)に集計する。

    items: iterable of (key_unet, diff, weight)

    戻り値 dict:
        matrix       {block: {element: 加重平均diff}}
        sub_matrix   {block: {element: {sub: 加重平均diff}}}
        top_keys     [(key, diff), ...] 差分が大きい順に最大20件
        global_mean  全体の加重平均diff
        n_keys       集計したキー数
    """
    acc = {}         # (block, elem) -> [dw, w]
    sub_acc = {}     # (block, elem, sub) -> [dw, w]
    top = []
    tot_dw = 0.0
    tot_w = 0.0
    n = 0

    for key_unet, diff, weight in items:
        diff = float(diff)
        weight = float(weight)
        if weight <= 0:
            continue
        block = block_label(key_unet)
        elem = classify_element(key_unet)
        sub = classify_sub(key_unet)

        cell = acc.setdefault((block, elem), [0.0, 0.0])
        cell[0] += diff * weight
        cell[1] += weight
        if sub is not None:
            sc = sub_acc.setdefault((block, elem, sub), [0.0, 0.0])
            sc[0] += diff * weight
            sc[1] += weight

        tot_dw += diff * weight
        tot_w += weight
        n += 1
        top.append((key_unet, diff))

    matrix = {}
    for (block, elem), (dw, w) in acc.items():
        if w > 0:
            matrix.setdefault(block, {})[elem] = dw / w

    sub_matrix = {}
    for (block, elem, sub), (dw, w) in sub_acc.items():
        if w > 0:
            sub_matrix.setdefault(block, {}).setdefault(elem, {})[sub] = dw / w

    top.sort(key=lambda kv: kv[1], reverse=True)
    global_mean = (tot_dw / tot_w) if tot_w > 0 else 0.0
    return {
        "matrix": matrix,
        "sub_matrix": sub_matrix,
        "top_keys": top[:20],
        "global_mean": global_mean,
        "n_keys": n,
    }


def build_diff_report(result, missing1=0, missing2=0, metric="relative_l2"):
    lines = [
        u"metric: %s" % metric,
        u"keys compared: %d" % result["n_keys"],
        u"global mean diff: %.4f" % result["global_mean"],
    ]
    if missing1 or missing2:
        lines.append(u"skipped (key only in one model): "
                     u"model1-only=%d, model2-only=%d" % (missing1, missing2))
    lines.append(u"")

    matrix = result["matrix"]
    header = u"block   " + u"".join(u"%8s" % e for e in MATRIX_ELEMENTS)
    lines.append(header)
    for block in BLOCKS_ORDER:
        if block not in matrix:
            continue
        row = matrix[block]
        cells = u"".join(
            (u"%8.3f" % row[e]) if e in row else u"       ."
            for e in MATRIX_ELEMENTS)
        lines.append(u"%-7s %s" % (block, cells))

    lines.append(u"")
    lines.append(u"=== most different keys (top %d) ==="
                 % len(result["top_keys"]))
    for key, diff in result["top_keys"]:
        lines.append(u"%.4f  %s" % (diff, key))
    return u"\n".join(lines)


def recipe_from_diff(matrix, threshold, ratio, scale_by_diff=False):
    """差分マトリクスから自動マージレシピ文字列を作る。

    差分がthreshold以上のブロック×要素だけに比率を割り当てる。
    scale_by_diff=Trueなら比率を差分の大きさに比例させる。
    other(構造部)はレシピトークンが無いので対象外。
    戻り値 (recipe文字列, 生成行数)。
    """
    lines = [u"# Model Diff Viewer から自動生成",
             u"# 差分>=%.2f のブロック×要素を model2 へ %.2f で寄せる"
             % (threshold, ratio),
             u"0.0"]
    n = 0
    for block in BLOCKS_ORDER:
        row = matrix.get(block)
        if not row:
            continue
        for elem in ("attn1", "attn2", "ff", "norm", "proj"):
            v = row.get(elem)
            if v is None or v < threshold:
                continue
            r = ratio * v if scale_by_diff else ratio
            r = max(0.0, min(1.0, r))
            for tok in _ELEM_TO_RECIPE[elem]:
                lines.append(u"%s:%s:%.3f" % (block, tok, r))
                n += 1
    return u"\n".join(lines), n
