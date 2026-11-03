# Studio self-hosted fonts

Checked and built: 2026-11-03. These assets belong to the SajuPinggye content
studio. They do not change the SajuPinggye app or the SelfSuggestion board.

## Files and families

- `studio-serif-cjk-v1.woff2`: **Studio Serif**, Noto Serif CJK KR 2.003,
  variable weight 400–600, default 400.
- `studio-sans-cjk-v1.woff2`: **Studio Sans**, Noto Sans CJK KR 2.004,
  variable weight 400–700, default 400.
- `fonts.css`: local `@font-face` definitions. No CDN or installed Noto font is
  required; there is deliberately no `local()` source.
- `OFL-NotoSerifCJK.txt` and `OFL-NotoSansCJK.txt`: complete upstream SIL Open
  Font License 1.1 texts. Their upstream license files are identical.

Final download sizes and SHA-256:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| Studio Serif | 20,571,104 | `f609a4376caf72efefc0d6ace0d8bcfaea4458cb406e0a373ada9a55c0575023` |
| Studio Sans | 14,126,764 | `42ef41d972f05ffc5104fd6879ffdf0624663ea7839e5f73f329193d423e7416` |

The two files total 34,697,868 bytes (33.1 MiB). They are deliberately larger
than regional or campaign-only subsets. Keeping one variable resource per
family also supports intermediate weights without synthetic bold or additional
weight downloads. These assets should be cached by their versioned filenames.

Only the weight axes have been restricted. **No Unicode characters, glyphs,
language systems, or OpenType layout features have been removed.** In particular,
these are the full CJK font resources, not the smaller KR regional subsets and
not a subset of the campaign text. A future edit can use arbitrary characters
covered by the original font.

The source character maps contain 44,777 entries for Serif and 44,810 for Sans;
both fonts retain all 65,535 upstream glyphs. Both contain all 11,172 modern
Hangul syllables, U+3041–3096 hiragana, U+30A1–30FA katakana, and U+0020–007E
Latin text. Serif includes all U+3400–4DBF and U+4E00–9FFF ideographs. Sans
2.004 predates 26 additions at the ends of those two blocks; use Studio Serif
after Studio Sans in a fallback stack for them. This is the upstream repertoire,
not a promise of every Unicode character: emoji and later CJK extensions may
still require another appropriate font.

## Renderer integration

Load `assets/fonts/fonts.css` in the document, or import it from the studio's
root `fonts.css` using `@import url('./assets/fonts/fonts.css');`.

Suggested Canvas font strings:

```js
context.font = '600 80px "Studio Serif", serif';
context.font = '400 42px "Studio Sans", "Studio Serif", sans-serif';
```

Before measuring, drawing, or exporting, explicitly load each family/weight in
use. `document.fonts.ready` alone need not request a face that has not yet been
used by the page:

```js
await Promise.all([
  document.fonts.load('400 42px "Studio Sans"'),
  document.fonts.load('600 80px "Studio Sans"'),
  document.fonts.load('400 42px "Studio Serif"'),
  document.fonts.load('600 80px "Studio Serif"')
]);
await document.fonts.ready;
```

These KR resources include Japanese glyphs and OpenType `locl` language
substitution. Tag HTML and every export canvas with the content locale, for
example `canvas.lang = 'ja'`. Where supported, also set `context.lang = 'ja'`.
This enables Japanese regional glyph forms instead of relying on the Korean
default forms. The same families cover KO, JA, and EN; no separate JP family is
declared.

Use supported numeric weights. Do not request 700 from Studio Serif, whose
actual weight range ends at 600; otherwise the browser may synthesize a bold.

## Official sources

Only the official `notofonts/noto-cjk` repository was used.

Noto Serif CJK KR 2.003, tag `Serif2.003`, commit
`9b0f1436e455d902de067a2501422e5dc71ad16b`:

- [Full-CJK download guide](https://github.com/notofonts/noto-cjk/blob/Serif2.003/Serif/README.md)
- [Source variable TTF](https://raw.githubusercontent.com/notofonts/noto-cjk/9b0f1436e455d902de067a2501422e5dc71ad16b/Serif/Variable/TTF/NotoSerifCJKkr-VF.ttf)
- [License](https://raw.githubusercontent.com/notofonts/noto-cjk/9b0f1436e455d902de067a2501422e5dc71ad16b/Serif/LICENSE)
- Source SHA-256: `b5162725c15f3ef91e53de76291c5dc555ef7576578d43423d2fd9ae40559ad1`.
- Copyright © 2017–2024 Adobe (http://www.adobe.com/).

Noto Sans CJK KR 2.004, tag `Sans2.004`, commit
`523d033d6cb47f4a80c58a35753646f5c3608a78`:

- [Full-CJK download guide](https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/README.md)
- [Source variable TTF](https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/Variable/TTF/NotoSansCJKkr-VF.ttf)
- [License](https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/LICENSE)
- Source SHA-256: `7715af52f5fe77153ce5678546258993982d2da61abea8d25fb89eb5aaec5ca6`.
- Copyright © 2014–2021 Adobe (http://www.adobe.com/), with Reserved Font Name
  “Source”. These are Noto font resources; “Studio” is only the CSS family alias.

License SHA-256 (each):
`6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2`.

## Reproduction

Conversion uses FontTools 4.68.0 and Brotli 1.2.1. Download the pinned source
TTFs above, then apply the following independently to each font:

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont(source_path)
original_cmap = font.getBestCmap()
font = instantiateVariableFont(
    font,
    {"wght": (400, 400, maximum_weight)},  # Serif: 600; Sans: 700
    inplace=True,
    updateFontNames=True,
)
font.flavor = "woff2"
font.save(output_path)
assert TTFont(output_path).getBestCmap() == original_cmap
```

The original SajuPinggye `gak-*-v1.woff2` files were examined and intentionally
not copied. They are SajuGak, a modified Noto Serif KR ornament font with only
113 Hanja plus Hangul “나”; they are neither a Sans family nor a general-purpose
Korean/Japanese body font.
