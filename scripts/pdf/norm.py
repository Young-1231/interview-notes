import unicodedata, sys
# 康熙部首 / CJK 部首补充 / CJK 兼容表意字 -> 标准汉字;另外修正飞书导出的个别异体
FIX = {"戶": "户", "⻓": "长", "⻅": "见", "⻛": "风", "⻔": "门", "⻝": "食", "⻜": "飞", "⻢": "马", "⻋": "车", "⻓": "长", "⻚": "页", "⻉": "贝", "⻬": "齐", "⻆": "角"}
for f in sys.argv[1:]:
    s = open(f, encoding="utf-8").read()
    s = "".join(FIX.get(c) or (unicodedata.normalize("NFKC", c) if 0x2E80 <= ord(c) <= 0x2FDF or 0xF900 <= ord(c) <= 0xFAFF else c) for c in s)
    open(f, "w", encoding="utf-8").write(s)
    print(f, "left-over radicals:", sum(1 for c in s if 0x2E80 <= ord(c) <= 0x2FDF))
