#!/usr/bin/env python3
"""
捕获 Stitch Tailwind 编译产物 → 语义色变量化 → src/styles/stitch.css + 暗色 token

用法 (在项目根目录):
  python3 scripts/build-stitch-css.py <捕获的编译CSS文件> [--dark-only]

流程:
  1. 读取无头浏览器捕获的 Tailwind CDN 编译 CSS (5 页合并去重)
  2. 把 22 个 Stitch 语义色 rgb(a b c / → rgb(var(--sc-*) /  (亮色 token 值 = 原字面值, 逐字节等价)
  3. 输出 src/styles/stitch.css (亮色 = 捕获产物原样变量化) + 更新 src/styles/tokens.css 语义层
  4. 暗色值集中在 tokens.css 的 .dark 作用域 (dark-theme 覆盖: 暗色取自现品牌暗色体系)

设计依据: docs/DESIGN.md §9.0 (照搬路线) / §1 (暗色方案 α)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src/styles/stitch.css'
TOKENS = ROOT / 'src/styles/tokens.css'

# 亮色: Stitch 字面值 (变量化基准, 不可改动) → 暗色: 品牌灰绿暗色体系 (DESIGN.md §2)
# key = rgb 三元组, value = (token 名, 暗色值)
COLOR_MAP = {
    # -- primary 系
    'rgb(65 91 47':   ('--sc-primary',                 '#4F6A3C'),
    'rgb(89 116 69':  ('--sc-primary-container',       '#597445'),
    'rgb(205 236 179': ('--sc-primary-fixed',          '#6B8A52'),
    'rgb(10 32 0':    ('--sc-on-primary-fixed',        '#CDE3B0'),
    'rgb(81 100 64':  ('--sc-secondary',               '#A3C08B'),
    'rgb(211 234 188': ('--sc-secondary-container',    '#3D5230'),
    'rgb(87 106 69':  ('--sc-on-secondary-container',  '#D7E8C2'),
    'rgb(177 208 152': ('--sc-primary-fixed-dim',      '#557043'),
    'rgb(184 206 161': ('--sc-secondary-fixed-dim',     '#557043'),
    'rgb(75 102 56':  ('--sc-secondary-fixed-dim-b',      '#557043'),
    'rgb(15 32 4':    ('--sc-on-secondary-fixed',       '#D7E8C2'),
    'rgb(52 77 35':   ('--sc-on-primary-fixed-variant', '#CDE3B0'),
    # -- surface 系
    'rgb(250 249 245': ('--sc-surface',                '#171B16'),
    'rgb(255 255 255': ('--sc-white',                  '#20241E'),
    'rgb(244 244 240': ('--sc-surface-container-low',  '#1C211C'),
    'rgb(239 238 234': ('--sc-surface-container',      '#232823'),
    'rgb(233 232 228': ('--sc-surface-container-high', '#2A302A'),
    'rgb(227 226 223': ('--sc-surface-container-highest', '#303630'),
    'rgb(242 241 237': ('--sc-inverse-on-surface',     '#E8EBE3'),
    'rgb(47 49 46':   ('--sc-inverse-surface',         '#E8EBE3'),
    'rgb(219 218 214': ('--sc-surface-dim',            '#151914'),
    'rgb(245 243 236': ('--sc-surface-alt',            '#1E2320'),
    # -- 文字/轮廓
    'rgb(27 28 26':   ('--sc-on-surface',              '#E8EBE3'),
    'rgb(68 72 62':   ('--sc-on-surface-variant',      '#BFC5B6'),
    'rgb(78 87 73':   ('--sc-tertiary',                 '#9AA48E'),
    'rgb(116 121 109': ('--sc-outline',                '#8A9280'),
    'rgb(196 200 187': ('--sc-outline-variant',        '#39413A'),
    # -- error 系
    'rgb(186 26 26':  ('--sc-error',                   '#F2A8A8'),
    'rgb(255 218 214': ('--sc-error-container',        '#52201F'),
    'rgb(147 0 10':   ('--sc-on-error-container',      '#FFDAD6'),
    # -- 特殊 (保留字面, 不变量化的对象)
    # rgb(0 0 0 阴影/遮罩, rgb(59 130 246 tailwind 默认 ring, 其余离群色保留)
}

# 不变量化的 (阴影/黑遮罩/默认ring/离群一次色)
SKIP = {'rgb(0 0 0', 'rgb(59 130 246', 'rgb(229 181 130'}  # 阴影/黑遮罩/tailwind默认ring/稿内字面色


def build_css(src: str) -> str:
    # 1) 变量化: rgb(65 91 47 / → rgb(var(--sc-primary) /  (含 alpha 写法; 不带 alpha 的 w → h-full/keep)
    for key, (name, _) in COLOR_MAP.items():
        src = src.replace(key + ' /', 'rgb(var(' + name + ') /')
    # 2) 不带 alpha 的语义色: rgb(65 91 47) → rgb(var(--sc-primary) / 1)  (Tailwind w/o alpha form)
    for key, (name, _) in COLOR_MAP.items():
        src = src.replace(key + ')', 'rgb(var(' + name + ') / 1)')
    return src


def main():
    if len(sys.argv) < 2:
        sys.exit('usage: build-stitch-css.py <compiled.css> [--dark-only]')
    src = open(sys.argv[1], encoding='utf-8').read()
    dark_only = '--dark-only' in sys.argv
    css = build_css(src)
    if not dark_only:
        OUT.write_text(css, encoding='utf-8')
        print(f'✅ {OUT.relative_to(ROOT)} 已生成 ({len(css)/1024:.1f} KB)')
    # tokens 层: 亮色 = 原字面值; 暗色 = COLOR_MAP 映射
    lines = ['/* 语义色: 亮色 = Stitch 编译产物字面值 (照搬基准, 不可改动); 暗色 = 品牌灰绿体系 (DESIGN.md §2) */']
    lines.append(':root {')
    for key, (name, dark) in COLOR_MAP.items():
        nums = key[4:].strip().split()
        light = ' '.join(nums)  # 空格分隔: rgb(R G B / A) 现代语法
        lines.append(f'  {name}: {light};')
    lines.append('}')
    lines.append('')
    lines.append('/* 暗色 (方案 α): .dark 作用域重定义 --sc-*; 亮色零改写 */')
    lines.append('.dark {')
    for key, (name, dark) in COLOR_MAP.items():
        h = dark.lstrip('#')
        trip = ' '.join(str(int(h[i:i+2], 16)) for i in (0, 2, 4))
        lines.append(f'  {name}: {trip};')
    lines.append('}')
    TOKENS.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'✅ {TOKENS.relative_to(ROOT)} 已生成 (亮 {len(COLOR_MAP)} / 暗 {len(COLOR_MAP)})')


if __name__ == '__main__':
    main()
