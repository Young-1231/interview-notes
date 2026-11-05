import re, sys
# 去掉飞书代码块导出时带上的行号
for f in sys.argv[1:]:
    s = open(f, encoding="utf-8").read()
    def fix(m):
        lines = m.group(1).split("\n")
        nums = [re.match(r"^(\d+)( |$)", l) for l in lines if l.strip()]
        if nums and sum(1 for x in nums if x) >= 0.8 * len(nums):
            lines = [re.sub(r"^\d+ ?", "", l) for l in lines]
        return "```\n" + "\n".join(lines) + "```"
    open(f, "w", encoding="utf-8").write(re.sub(r"```\n(.*?)```", fix, s, flags=re.S))
