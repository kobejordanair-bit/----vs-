# 朝堂危局｜擴充人物肖像（第三版）

## 生成方式

使用 built-in `image_gen.imagegen`，default built-in tool mode。每張肖像使用一個獨立全新生成呼叫，`transparent_background: false`，未傳入 reference images、`referenced_image_paths` 或 `num_last_images_to_include`。生成前以 `view_image` 檢視原有韓信、蕭何、魏徵肖像，僅作人工風格判斷；未作為工具參考圖輸入。未使用 CLI、API key、後製裁切或影像改寫。

這些肖像是架空遊戲中的歷史人物美術詮釋，並非可驗證的歷史容貌。原始生成 PNG 保留，原有三位人物資產未覆寫。

## 最終資產

| 資產 | 尺寸 | Bytes | 視覺辨識 |
|---|---|---|---|
| zhang-liang.png | 1086 × 1448 | 2552964 | 張良：玉青袍、卷圖、沉靜而纖瘦。 |
| chen-ping.png | 1086 × 1448 | 2345908 | 陳平：靛青袍、封函、審慎的微笑與較寬臉型。 |
| sun-wu.png | 1086 × 1448 | 2517220 | 孫武：風霜面容、青銅與皮甲、軍事竹簡。 |
| shang-yang.png | 1086 × 1448 | 2311898 | 商鞅：黑與朱紅袍、整齊法令竹簡、嚴峻直立。 |
| su-qin.png | 1086 × 1448 | 2479098 | 蘇秦：暖銅袍與旅披、外交符節、開放的說服手勢。 |

## 保存位置

### zhang-liang.png

- 原始生成檔：`C:/Users/user/.codex/generated_images/01a0f314-0b9e-7bc2-97aa-44683623e303/exec-74594ce8-afdf-48d6-9dc2-0ddc3cf16f4a.png`
- 專案最終檔：`C:/Users/user/Documents/Codex/2026-09-26/github-plugin-github-openai-curated-remote-2/app/backend/static/game/court/zhang-liang.png`

### chen-ping.png

- 原始生成檔：`C:/Users/user/.codex/generated_images/01a0f314-0b9e-7bc2-97aa-44683623e303/exec-9b9b6003-de76-4855-bc7b-711ef58004b7.png`
- 專案最終檔：`C:/Users/user/Documents/Codex/2026-09-26/github-plugin-github-openai-curated-remote-2/app/backend/static/game/court/chen-ping.png`

### sun-wu.png

- 原始生成檔：`C:/Users/user/.codex/generated_images/01a0f314-0b9e-7bc2-97aa-44683623e303/exec-3a46e1fa-7124-42b7-93bc-4d699f72b739.png`
- 專案最終檔：`C:/Users/user/Documents/Codex/2026-09-26/github-plugin-github-openai-curated-remote-2/app/backend/static/game/court/sun-wu.png`

### shang-yang.png

- 原始生成檔：`C:/Users/user/.codex/generated_images/01a0f314-0b9e-7bc2-97aa-44683623e303/exec-4b022290-fafb-4ec9-abc2-ad71d3183c39.png`
- 專案最終檔：`C:/Users/user/Documents/Codex/2026-09-26/github-plugin-github-openai-curated-remote-2/app/backend/static/game/court/shang-yang.png`

### su-qin.png

- 原始生成檔：`C:/Users/user/.codex/generated_images/01a0f314-0b9e-7bc2-97aa-44683623e303/exec-6ae41fe8-4d1b-4bbb-a147-9078df3c1685.png`
- 專案最終檔：`C:/Users/user/Documents/Codex/2026-09-26/github-plugin-github-openai-curated-remote-2/app/backend/static/game/court/su-qin.png`

## 視覺檢查

五張生成完成後逐張目視檢查：均為獨立 3:4 直幅人物；頭與髮髻完整、手部與持物可辨；無 UI、標題、浮水印與可讀文字。暖琥珀側光、冷雨庭院、深色木柱、絲麻／甲冑質地與原有資產保持一致。各人物以臉型、年齡、表情、服飾、姿態及道具區分。實際介面裁切位置仍由使用它們的 UI 設定決定。

## 完整最終提示詞

### zhang-liang.png

```text
Use case: historical-scene
Asset type: single 3:4 vertical half-body character portrait for a serious historical strategy game
Primary request: Zhang Liang, an illustrative interpretation of the early Han strategist, a calm slender Chinese man about 42 years old with a long narrow face, fine straight eyebrows, thoughtful gentle eyes and a short delicate beard. Give him an unmistakably contemplative, lightly built presence.
Subject details: muted jade-green layered silk and hemp robe with an ivory collar, simple early Han hair binding and bundled topknot, holding a partly rolled map scroll with natural relaxed hands. The map has abstract lines only, no readable writing. Historically plausible restrained clothing, no later dynasty court hat.
Scene/backdrop: dark ancient Chinese timber court, rain-softened courtyard and mist behind him, unobtrusive architectural silhouettes.
Style/medium: refined ink wash combined with finely painted silk and realistic brushwork, solemn historical theatre, believable anatomy and facial texture. This is interpretive game art, not a verified historical likeness or modern celebrity likeness.
Composition/framing: one person from torso upward, 3:4 portrait, whole head and topknot comfortably visible, shoulders and hands fully readable, quietly poised three-quarter stance.
Lighting/mood: restrained dramatic warm amber side light with quiet teal shadows, patient strategic concentration.
Color palette: charcoal black, ivory paper, muted jade and teal, aged bronze, very small cinnabar accents. Detailed textile texture and painterly dark background.
Constraints: no readable writing, no text, no UI, no watermark, no logos, no anime, no fantasy costume, no image grid. One complete beautiful portrait.
```

### chen-ping.png

```text
Use case: historical-scene
Asset type: single 3:4 vertical half-body character portrait for a serious historical strategy game
Primary request: Chen Ping, an illustrative interpretation of the early Han councillor, a Chinese man about 48 years old with a broad angular face, slightly heavy-lidded perceptive eyes, a neat compact moustache and a closely trimmed beard. His expression is subtly guarded and analytical, with an almost imperceptible knowing half-smile; avoid making him a caricature or villain.
Subject details: deep indigo hemp and silk robe with understated ivory inner collar and small aged-bronze fastener, modest plausible early Han headgear, holding a closed folded letter with a plain cinnabar seal in one natural hand. Letter has no readable writing. Distinctive sturdy facial structure and compact posture.
Scene/backdrop: dark ancient Chinese timber court, rain-softened courtyard and mist behind him, indistinct warm lamp glow.
Style/medium: refined ink wash combined with finely painted silk and realistic brushwork, solemn historical theatre, believable anatomy and lived facial texture. Interpretive game art, not a verified historical likeness or modern celebrity likeness.
Composition/framing: one person from torso upward, 3:4 portrait, all headgear comfortably visible, hands complete, quietly guarded three-quarter stance. Different face and silhouette from a slender gentle scholar.
Lighting/mood: warm amber side light with quiet teal shadows, measured discretion and tension.
Color palette: charcoal black, ivory, muted indigo and teal, aged bronze, restrained cinnabar seal accent.
Constraints: no readable writing, no text, no UI, no watermark, no logos, no anime, no fantasy costume, no image grid. One complete beautiful portrait.
```

### sun-wu.png

```text
Use case: historical-scene
Asset type: single 3:4 vertical half-body character portrait for a serious historical strategy game
Primary request: Sun Wu, an illustrative interpretation of the ancient Chinese military thinker, a weathered Chinese man about 58 years old with a broad square face, strong brow, deep-set steady eyes, sun-lined skin and a close salt-and-pepper beard. His presence is disciplined and observant rather than aggressive.
Subject details: restrained historically plausible late Spring and Autumn or early Warring States dark leather and aged-bronze lamellar armour over an earth-coloured robe, hair in a simple topknot without elaborate crown, holding a modest bundle of military bamboo strips with natural hands. No readable writing on strips. Plain practical equipment, no ornamental dragons or later imperial court hat.
Scene/backdrop: dark ancient Chinese timber command hall near a rainy court, subtle mist and distant military standards without symbols or writing.
Style/medium: refined ink wash combined with finely painted silk and realistic brushwork, solemn historical theatre, believable anatomy and aged facial texture. Interpretive game art, not a verified historical likeness or modern celebrity likeness.
Composition/framing: one person from torso upward, 3:4 portrait, head and topknot fully visible, broad shoulders, steady nearly frontal posture, hands complete.
Lighting/mood: dramatic amber side light and quiet teal shadows, patient command and disciplined restraint.
Color palette: charcoal black, ivory, dark olive and muted teal, aged bronze, very small cinnabar accents. Real material texture, painterly atmospheric background.
Constraints: no readable writing, no text, no UI, no watermark, no logos, no anime, no oversized fantasy armour, no image grid. One complete beautiful portrait.
```

### shang-yang.png

```text
Use case: historical-scene
Asset type: single 3:4 vertical half-body character portrait for a serious historical strategy game
Primary request: Shang Yang, an illustrative interpretation of the Warring States reforming minister, a Chinese man about 46 years old with a lean severe face, high cheekbones, narrow direct eyes, a straight firm mouth and a short sharply trimmed beard. Convey exacting resolve and intellectual conviction without theatrical cruelty.
Subject details: austere black robe with deep restrained cinnabar panels, ivory inner collar and a simple bronze belt, plausible Warring States hair binding and modest topknot, holding a straight neatly ordered bundle of statutory bamboo slips with natural hands. Slips have no readable writing. His upright posture and rigidly aligned materials distinguish him from a relaxed adviser.
Scene/backdrop: dark ancient Chinese timber court, subtle rain and cool mist beyond the pillars, sparse shelves or stacked bamboo materials in shadow.
Style/medium: refined ink wash combined with finely painted silk and realistic brushwork, solemn historical theatre, believable anatomy and distinctive facial texture. Interpretive game art, not a verified historical likeness or modern celebrity likeness.
Composition/framing: one person from torso upward, 3:4 portrait, whole head and topknot comfortably visible, complete hands and ordered slips, upright three-quarter stance.
Lighting/mood: sharp restrained amber side light, quiet teal shadows, determined and uncompromising calm.
Color palette: charcoal black, ivory, deep cinnabar red, muted teal, aged bronze. Fine hemp and silk texture, no gaudy ornament.
Constraints: no readable writing, no text, no UI, no watermark, no logos, no anime, no fantasy costume or later-dynasty crown, no image grid. One complete beautiful portrait.
```

### su-qin.png

```text
Use case: historical-scene
Asset type: single 3:4 vertical half-body character portrait for a serious historical strategy game
Primary request: Su Qin, an illustrative interpretation of the Warring States travelling diplomat, a Chinese man about 37 years old with a long oval face, expressive alert eyes, arched brows, a fine neat moustache and a small pointed beard. Convey eloquence, attentive confidence and the fatigue of long travel, with a slight conversational smile.
Subject details: layered warm bronze-brown robe and weathered dark teal travel mantle, ivory inner collar, modest historically plausible Warring States hair binding with whole topknot visible, holding a plain bronze diplomatic tally and folded unmarked silk document with natural hands. Distinctive open shoulders and poised gesture as if making a careful argument, no exaggerated grin.
Scene/backdrop: dark ancient Chinese timber reception court opening toward a rainy courtyard and cool mist, unobtrusive architectural shapes.
Style/medium: refined ink wash combined with finely painted silk and realistic brushwork, solemn historical theatre, believable anatomy and textured face. Interpretive game art, not a verified historical likeness or modern celebrity likeness.
Composition/framing: one person from torso upward, 3:4 portrait, comfortable margin around full head, shoulders and natural complete hands, engaged three-quarter stance.
Lighting/mood: dramatic warm amber side light and quiet teal shadows, intelligent conversational warmth amid uncertainty.
Color palette: charcoal black, ivory, warm bronze-brown, muted teal, tiny cinnabar accents, textured worn silk and hemp.
Constraints: no readable writing on tally or document, no text, no UI, no watermark, no logos, no anime, no fantasy costume, no modern clothing, no image grid. One complete beautiful portrait.
```
