# -*- coding: utf-8 -*-
"""ComfyUI-ModelDumpster — モデル解析ノードの寄せ集め(SDXL専用)。

- ModelDiffViewer:       2モデルの差分をブロック×要素ヒートマップで表示
- DiffToRecipe:          差分から自動マージレシピを生成
- ModelAblationAnalyzer: ブロックを参照に戻して絵の変化=重要度を実測

差分ドリブンのマージ地図と、絵の「どこにどのブロックが効いてるか」の実測解析。
マージ本体(ComfyUI-RecipeMerge)とは独立。DiffToRecipeの出力recipeは
RecipeMergeの Elemental Merge (Recipe) に繋ぐと自動マージできる(任意)。
"""

import json

import torch

import comfy.sample
import comfy.samplers

from .model_keys import block_label, classify_element, MATRIX_ELEMENTS
from .diff_aggregate import (aggregate_diffs, build_diff_report,
                             recipe_from_diff, BLOCKS_ORDER)
from .latent_swap import EmptyLatentImageSwap


def _unet_state_dict(model):
    """ModelPatcherからUNet(diffusion_model.*)のstate_dictを取り出す。"""
    sd = model.model.state_dict()
    prefix = "diffusion_model."
    return {k: v for k, v in sd.items() if k.startswith(prefix)}, prefix


def _key_diff(af, bf, metric):
    """1キー分の差分値(0=同一, 1に近いほど別物)。"""
    if metric == "cosine":
        na = float(af.norm())
        nb = float(bf.norm())
        if na <= 1e-8 or nb <= 1e-8:
            return 0.0
        cos = float((af * bf).sum()) / (na * nb)
        val = 1.0 - cos
    else:  # relative_l2
        denom = max(float(af.norm()), float(bf.norm()))
        if denom <= 1e-8:
            return 0.0
        val = float((af - bf).norm()) / denom
    return min(1.0, max(0.0, val))


def _model_diff(model1, model2, metric="relative_l2"):
    """2モデルのUNetをキー単位で比較。差分をブロック×要素に集計する。"""
    sd1, prefix = _unet_state_dict(model1)
    sd2, _ = _unet_state_dict(model2)
    keys1 = set(sd1.keys())
    keys2 = set(sd2.keys())
    common = keys1 & keys2
    m1only = len(keys1 - keys2)
    m2only = len(keys2 - keys1)

    items = []
    for k in common:
        a = sd1[k]
        b = sd2[k]
        if a.shape != b.shape:
            continue
        af = a.detach().to("cpu", torch.float32).flatten()
        bf = b.detach().to("cpu", torch.float32).flatten()
        val = _key_diff(af, bf, metric)
        items.append((k[len(prefix):], val, a.numel()))

    return aggregate_diffs(items), m1only, m2only


class ModelDiffViewer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model1": ("MODEL",),
                "model2": ("MODEL",),
                "metric": (["relative_l2", "cosine"],),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("report", "heatmap_json")
    FUNCTION = "diff"
    CATEGORY = "advanced/model_analysis"
    OUTPUT_NODE = True
    DESCRIPTION = (u"2つのSDXLモデルのUNetをキー単位で比較し、ブロック×要素"
                   u"(タブでサブ要素まで)の違いの大きさをヒートマップ表示。"
                   u"metric: relative_l2=‖A-B‖/max‖‖ / cosine=1-cos類似度。"
                   u"heatmap_jsonをDiff→Recipeノードに繋ぐと自動マージできる。")

    def diff(self, model1, model2, metric):
        result, m1only, m2only = _model_diff(model1, model2, metric)
        report = build_diff_report(result, m1only, m2only, metric)
        payload = json.dumps({
            "matrix": result["matrix"],
            "sub_matrix": result["sub_matrix"],
            "global_mean": result["global_mean"],
            "n_keys": result["n_keys"],
            "metric": metric,
        })
        print("[ModelDiffViewer]\n" + report)
        return {"ui": {"heatmap": [payload]},
                "result": (report, payload)}


class DiffToRecipe:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "heatmap_json": ("STRING", {"forceInput": True}),
                "threshold": ("FLOAT", {"default": 0.3, "min": 0.0,
                                        "max": 1.0, "step": 0.01,
                                        "tooltip": u"この差分以上のブロック×"
                                        u"要素だけをマージ対象にする"}),
                "ratio": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0,
                                    "step": 0.01,
                                    "tooltip": u"対象を model2 へ寄せる比率"}),
                "scale_by_diff": ("BOOLEAN", {"default": False,
                                  "tooltip": u"ONで比率を差分の大きさに比例"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("recipe", "info")
    FUNCTION = "convert"
    CATEGORY = "advanced/model_analysis"
    DESCRIPTION = (u"Model Diff Viewer の heatmap_json から、差分の大きい所だけを"
                   u"混ぜる自動マージレシピを生成する。出力recipeを Elemental "
                   u"Merge (Recipe) の recipe入力に繋げばそのままマージできる。")

    def convert(self, heatmap_json, threshold, ratio, scale_by_diff):
        try:
            data = json.loads(heatmap_json) if heatmap_json.strip() else {}
        except ValueError:
            raise ValueError(u"heatmap_jsonが読めません(Diff Viewerに繋ぐ)")
        matrix = data.get("matrix", {}) if isinstance(data, dict) else {}
        recipe, n = recipe_from_diff(matrix, threshold, ratio, scale_by_diff)
        info = (u"生成: %d 行 (threshold=%.2f, ratio=%.2f, scale_by_diff=%s)"
                % (n, threshold, ratio, scale_by_diff))
        print("[DiffToRecipe] " + info)
        return (recipe, info)


def _sample_latent(model, noise, latent_image, positive, negative,
                   seed, steps, cfg, sampler_name, scheduler, denoise):
    """固定ノイズで1回サンプリングして潜在を返す(KSamplerと同じ経路)。"""
    return comfy.sample.sample(
        model, noise, steps, cfg, sampler_name, scheduler,
        positive, negative, latent_image, denoise=denoise,
        disable_noise=False, force_full_denoise=False,
        noise_mask=None, callback=None, disable_pbar=True, seed=seed)


def _group_keys(ref_patches, granularity):
    """UNetキーを (block, element) でグループ化する。

    granularity="block" なら要素をまとめてブロック単位に(高速)。
    """
    prefix = "diffusion_model."
    groups = {}
    for k in ref_patches:
        if not k.startswith(prefix):
            continue
        ku = k[len(prefix):]
        block = block_label(ku)
        elem = classify_element(ku)
        groups.setdefault((block, elem), []).append(k)
    if granularity != "block":
        return groups
    merged = {}
    for (block, elem), keys in groups.items():
        merged.setdefault(block, {"keys": [], "elems": set()})
        merged[block]["keys"].extend(keys)
        merged[block]["elems"].add(elem)
    return merged  # {block: {"keys":[...], "elems":{...}}}


class ModelAblationAnalyzer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "model_ref": ("MODEL",),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "latent": ("LATENT",),
                "granularity": (["element", "block"],),
                "seed": ("INT", {"default": 0, "min": 0,
                                 "max": 0xffffffffffffffff}),
                "steps": ("INT", {"default": 1, "min": 1, "max": 50,
                                  "tooltip": u"1=最速の感度解析。上げるほど"
                                  u"生成に近く正確だが遅い"}),
                "cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 30.0,
                                  "step": 0.1}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS,),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS,),
                "denoise": ("FLOAT", {"default": 0.5, "min": 0.05, "max": 1.0,
                                      "step": 0.01,
                                      "tooltip": u"入力潜在にどれだけノイズを"
                                      u"乗せて探るか"}),
                "revert_strength": ("FLOAT", {"default": 1.0, "min": 0.1,
                                    "max": 1.0, "step": 0.05,
                                    "tooltip": u"ブロックを参照モデルへ戻す量"
                                    u"(1.0=完全に参照側)"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "LATENT")
    RETURN_NAMES = ("report", "heatmap_json", "baseline_latent")
    FUNCTION = "analyze"
    CATEGORY = "advanced/model_analysis"
    OUTPUT_NODE = True
    DESCRIPTION = (u"この絵のどこにどのブロックが効いてるかを実測する(SDXL専用)。"
                   u"固定ノイズで生成し、ブロックを1つずつ参照モデルに戻して"
                   u"出力の変化量=重要度をヒートマップ化。metric的にはablation。")

    def analyze(self, model, model_ref, positive, negative, latent,
                granularity, seed, steps, cfg, sampler_name, scheduler,
                denoise, revert_strength):
        latent_image = latent["samples"]
        latent_image = comfy.sample.fix_empty_latent_channels(
            model, latent_image)
        # 全実行で同じノイズを使う(唯一の変数をブロック改変だけにする)
        noise = comfy.sample.prepare_noise(latent_image, seed)

        def run(m):
            s = _sample_latent(m, noise, latent_image, positive, negative,
                               seed, steps, cfg, sampler_name, scheduler,
                               denoise)
            return s.detach().to("cpu", torch.float32)

        base = run(model)
        base_norm = float(base.norm()) + 1e-8

        ref_patches = model_ref.get_key_patches("diffusion_model.")

        def revert_and_measure(keys):
            m = model.clone()
            patch = {k: ref_patches[k] for k in keys if k in ref_patches}
            if not patch:
                return None
            m.add_patches(patch, float(revert_strength),
                          1.0 - float(revert_strength))
            out = run(m)
            return float((out - base).norm()) / base_norm

        raw = {}  # (block, elem) -> importance
        if granularity == "block":
            merged = _group_keys(ref_patches, "block")
            for block, info in merged.items():
                imp = revert_and_measure(info["keys"])
                if imp is None:
                    continue
                for elem in info["elems"]:
                    raw[(block, elem)] = imp
        else:
            groups = _group_keys(ref_patches, "element")
            for (block, elem), keys in groups.items():
                imp = revert_and_measure(keys)
                if imp is not None:
                    raw[(block, elem)] = imp

        max_imp = max(raw.values()) if raw else 1.0
        max_imp = max(max_imp, 1e-8)
        matrix = {}
        for (block, elem), imp in raw.items():
            matrix.setdefault(block, {})[elem] = imp / max_imp  # 0..1正規化

        # report
        lines = [u"ablation (1-step sensitivity), granularity=%s" % granularity,
                 u"steps=%d denoise=%.2f revert=%.2f" % (steps, denoise,
                                                         revert_strength),
                 u"measured groups: %d" % len(raw),
                 u"(値は最大=1.0で正規化した相対重要度)", u""]
        header = u"block   " + u"".join(u"%8s" % e for e in MATRIX_ELEMENTS)
        lines.append(header)
        for block in BLOCKS_ORDER:
            if block not in matrix:
                continue
            row = matrix[block]
            cells = u"".join((u"%8.3f" % row[e]) if e in row else u"       ."
                             for e in MATRIX_ELEMENTS)
            lines.append(u"%-7s %s" % (block, cells))
        lines.append(u"")
        lines.append(u"=== most influential (raw) ===")
        for (block, elem), imp in sorted(raw.items(), key=lambda kv: -kv[1])[:15]:
            lines.append(u"%.4f  %s:%s" % (imp, block, elem))
        report = u"\n".join(lines)

        payload = json.dumps({
            "kind": "ablation",
            "matrix": matrix,
            "sub_matrix": {},
            "global_mean": (sum(raw.values()) / len(raw)) if raw else 0.0,
            "n_keys": len(raw),
            "metric": "ablation",
        })
        print("[ModelAblationAnalyzer]\n" + report)
        out_latent = latent.copy()
        out_latent["samples"] = base
        return {"ui": {"heatmap": [payload]},
                "result": (report, payload, out_latent)}


WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {
    "ModelDiffViewer": ModelDiffViewer,
    "DiffToRecipe": DiffToRecipe,
    "ModelAblationAnalyzer": ModelAblationAnalyzer,
    "EmptyLatentImageSwap": EmptyLatentImageSwap,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ModelDiffViewer": "Model Diff Viewer (Heatmap)",
    "DiffToRecipe": "Diff → Recipe (auto-merge)",
    "ModelAblationAnalyzer": "Model Ablation Analyzer (Heatmap)",
    "EmptyLatentImageSwap": "Empty Latent Image (Swap)",
}
