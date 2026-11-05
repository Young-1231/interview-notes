#!/bin/sh
# 重新从 PDF 生成 sources/bank-java.md 和 sources/ai-kb.md
#   sh scripts/pdf/convert.sh /path/to/java八股.pdf /path/to/ai知识库.pdf
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$DIR/../.." && pwd)
TMP=$(mktemp -d)
pdftohtml -xml -i -q -nodrm "$1" "$TMP/java" >/dev/null
pdftohtml -xml -i -q -nodrm "$2" "$TMP/ai" >/dev/null
python3 -I "$DIR/pdf2md.py" "$TMP/java.xml" "$ROOT/sources/bank-java.md"
python3 -I "$DIR/pdf2md.py" "$TMP/ai.xml" "$ROOT/sources/ai-kb.md"
python3 -I "$DIR/norm.py" "$ROOT/sources/bank-java.md" "$ROOT/sources/ai-kb.md"
python3 -I "$DIR/codeclean.py" "$ROOT/sources/bank-java.md" "$ROOT/sources/ai-kb.md"
python3 -I "$DIR/glue.py" "$ROOT/sources/bank-java.md" "$ROOT/sources/ai-kb.md"
rm -rf "$TMP"
