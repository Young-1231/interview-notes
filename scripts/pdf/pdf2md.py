"""PDF(飞书导出) -> Markdown。用 pdftohtml -xml 的字体/颜色/粗体信息还原结构。

规则(两份 PDF 通用):
- 字号 >= 30 的行: 一级/二级标题(文档标题 / 章节, 如「Java基础」「Agent通用专项」)
- 蓝色(#1356f0)「N.」开头 + 粗体的行: 一道题的题目
- SourceCodePro 字体: 代码行
- 其余: 答案正文。左缩进(left)明显大于正文的行视为列表/续行
用法: python3 -I pdf2md.py in.xml out.md
"""
import html
import re
import sys
import xml.etree.ElementTree as ET

src, dst = sys.argv[1], sys.argv[2]
raw = open(src, encoding="utf-8").read()
# pdftohtml 的 XML 里 <text> 内可能有 <b>/<i>/<a>,先保留粗体标记再解析
root = ET.fromstring(raw)

fonts = {}
for fs in root.iter("fontspec"):
    fonts[fs.get("id")] = {
        "size": int(fs.get("size")),
        "family": fs.get("family"),
        "color": fs.get("color"),
    }

# 收集所有文本片段 -> 按 (page, top) 聚成行
lines = []
for page in root.iter("page"):
    pno = int(page.get("number"))
    frags = []
    for t in page.iter("text"):
        txt = "".join(t.itertext())
        bold = t.find("b") is not None
        f = fonts.get(t.get("font"), {"size": 0, "family": "", "color": ""})
        frags.append({
            "top": int(t.get("top")), "left": int(t.get("left")), "h": int(t.get("height")),
            "w": int(t.get("width")), "text": txt, "bold": bold, **f,
        })
    frags.sort(key=lambda x: (x["top"], x["left"]))
    cur = []
    for fr in frags:
        # 同一行: top 差在行高一半以内
        if cur and abs(fr["top"] - cur[0]["top"]) <= max(6, cur[0]["h"] // 2):
            cur.append(fr)
        else:
            if cur:
                lines.append((pno, cur))
            cur = [fr]
    if cur:
        lines.append((pno, cur))


def line_text(frs):
    frs = sorted(frs, key=lambda x: x["left"])
    out, prev_end = "", None
    for fr in frs:
        t = fr["text"]
        if not t:
            continue
        gap = fr["left"] - prev_end if prev_end is not None else 0
        # 飞书导出把空格丢了:两个拉丁词片段相邻(或有可见间隙)时补空格
        latin_join = out and re.search(r"[A-Za-z0-9)]$", out) and re.match(r"[A-Za-z(]", t)
        if prev_end is not None and out and not out.endswith(" ") and not t.startswith(" ") and (gap > 6 or (latin_join and gap >= 3)):
            out += " "
        out += t
        prev_end = fr["left"] + fr["w"]
    return out.replace("​", "").rstrip()


# 页眉页脚过滤:飞书导出无页码,但有的页顶会重复标题,这里不额外处理
def classify(frs):
    text = line_text(frs)
    if not text.strip():
        return "blank", text
    big = max(fr["size"] for fr in frs)
    # 代码行:有等宽字体片段,其余片段只是灰色的「代码块」标签/行号
    is_code = any("SourceCodePro" in fr["family"] for fr in frs) and all(
        "SourceCodePro" in fr["family"] or fr["color"] == "#646a73" for fr in frs if fr["text"].strip())
    first = min(frs, key=lambda x: x["left"])
    if big >= 40:
        return "h1", text
    # 章节标题:java PDF 33/29 号,AI PDF 25/23 号,均为 Medium 字体;排除只有 emoji 的行
    if first["color"] == "#1356f0" and re.match(r"^\d+\.$", first["text"].strip()):
        if first["left"] < 60:
            return "q", text
        return "li", text  # 答案里的有序子列表
    medium = all("Medium" in fr["family"] for fr in frs if fr["text"].strip())
    words = len(re.sub(r"[^\w]", "", text))
    # 章节标题顶格(left≈43);答案里的小标题有缩进
    if big >= 23 and medium and words >= 2 and first["left"] < 50:
        return "h2", text
    if big >= 21 and medium and words >= 2:
        return "sub", text
    # 飞书代码块的「代码块」标签
    if text.strip() in ("代码块", "代码块 复制") and all(fr["color"] == "#646a73" for fr in frs if fr["text"].strip()):
        return "blank", text
    if is_code:
        return "code", text
    return "p", text


# 正文基准左边距(最常见的 p 行 left)
from collections import Counter
lefts = Counter(min(fr["left"] for fr in frs) for _, frs in lines if classify(frs)[0] == "p")
base_left = lefts.most_common(1)[0][0] if lefts else 0

out = []
in_code = False
code_left = None
qbuf = None  # 题目可能跨行


def flush_q():
    global qbuf
    if qbuf:
        t = re.sub(r"\s+", " ", qbuf).strip()
        t = t.strip('"“”')
        out.append(f"\n### {t}\n")
        qbuf = None


prev_kind = None
for pno, frs in lines:
    kind, text = classify(frs)
    left = min(fr["left"] for fr in frs)
    if kind != "code" and in_code:
        out.append("```\n")
        in_code = False
    if kind == "blank":
        prev_kind = kind
        continue
    if kind == "q":
        flush_q()
        qbuf = re.sub(r"^\d+\.\s*", "", text)
        prev_kind = "q"
        continue
    # 题目续行:题号之后、答案标记(💡/👍/回答要点)出现之前,与题目同缩进(left≈70)的行
    if qbuf is not None and prev_kind == "q" and kind in ("p", "sub") and 60 <= left <= 80 \
            and not re.match(r"^[💡👍]", text.strip()) and not text.strip().startswith("回答要点") \
            and all(fr["bold"] or "Medium" in fr["family"] or not fr["text"].strip() for fr in frs) \
            and not re.search(r"[：:]", text):
        qbuf += text
        continue
    flush_q()
    if kind == "h1":
        out.append(f"\n# {text.strip()}\n")
    elif kind == "h2":
        out.append(f"\n## {text.strip()}\n")
    elif kind == "code":
        # 去掉灰色的行号 / 「代码块」标签,只留等宽字体部分
        body = sorted((fr for fr in frs if "SourceCodePro" in fr["family"]), key=lambda x: x["left"])
        if not body:
            continue
        bl = body[0]["left"]
        t = line_text(body).strip()
        if not in_code:
            out.append("\n```\n")
            in_code = True
            code_left = bl
        indent = max(0, round((bl - code_left) / 9.6))  # SourceCodePro 16px 约 9.6px/字符
        out.append(" " * indent + t + "\n")
    elif kind == "sub":
        out.append("\n**" + re.sub(r"^👍\s*", "", text.strip()) + "**\n")
    elif kind == "li":
        out.append(re.sub(r"^(\d+)\.\s*", r"\1. ", text.strip()) + "\n")
    else:
        t = text.strip()
        if t in ("💡 回答要点：", "💡回答要点：", "回答要点：", "👍"):
            prev_kind = kind
            continue
        t = re.sub(r"^[💡👍]\s*", "", t)
        t = re.sub(r"^回答要点[：:]\s*", "", t)
        if not t:
            prev_kind = kind
            continue
        t = re.sub(r"^◦\s*", "   - ", t)
        t = re.sub(r"^▪\s*", "      - ", t)
        t = re.sub(r"^•\s*", "- ", t)
        out.append(t + "\n")
    prev_kind = kind
flush_q()
if in_code:
    out.append("```\n")

def in_fence(buf):
    return sum(1 for x in buf if x.startswith("```")) % 2 == 1


md = "".join(out)
# 题目行以未闭合的「（」结尾、或下一行以 ...）" 结尾的公司括号开头 -> 合并
md = re.sub(r"^(### [^\n]*[（(][^）)\n]*)\n([^\n]{0,80}[）)][\"”]?)\s*$", r"\1\2", md, flags=re.M)
md = re.sub(r"^(### [^\n]*?)\n([^\n#]{0,40}?[\"”]?[（(][^）)\n]*(?:银行|届|字节|美团|阿里|腾讯|蚂蚁|滴滴|PDD|拼多多|面)[^）)\n]*[）)])\s*$", r"\1\2", md, flags=re.M)
md = re.sub(r"\n```\n([^\n`]{1,40})\n```\n", lambda m: f" `{m.group(1).strip()}` ", md)
# 合并同一段落被 PDF 折行打断的行:中文行末无标点且下一行不是列表/标题时拼接
merged = []
for ln in md.split("\n"):
    if (merged and ln and merged[-1] and not merged[-1].startswith(("#", "```", " ")) and not ln.startswith(("#", "```", "- ", "* "))
            and not re.match(r"^\d+[、.．]", ln) and not re.match(r"^[（(]?[一二三四五六七八九十]+[、)）]", ln)
            and not re.search(r"[。：:；;！!？?」）)]$", merged[-1]) and not in_fence(merged)):
        merged[-1] += ln
    else:
        merged.append(ln)
open(dst, "w", encoding="utf-8").write(re.sub(r"\n{3,}", "\n\n", "\n".join(merged)).strip() + "\n")
print("wrote", dst)
