#!/usr/bin/env python3
"""从 WS/T 423—2022 官方 PDF 提取附录 A 的表 A.9 / A.10（年龄别 BMI 百分位）。

用法（Python 依赖为空，只调用系统里的 poppler `pdftotext`）：

    uv run scripts/extract_growth_bmi.py <PDF 或已提取的 .txt> [--out 输出.ts]

官方 PDF：
https://www.nhc.gov.cn/cms-search/downFiles/e38068f0a62d4a1eb1bd451414444ec1.pdf
（2022-09-19 发布、2023-03-01 实施；表 A.9 男童 / A.10 女童在 PDF 第 16–18 页。）

表格的年龄列是「岁 月」写法（0月 / 10 月 / 1岁 / 1 岁 10 月 / 2岁3月 / 6岁9月），
脚本换算成月龄并逐表校验：月龄序列连续且与 A.1–A.4 一致（0～23 每月、24～81 每 3 月）、
每行 8 列（月龄 + 7 个百分位）、P3…P97 单调不减、男女行数一致。
不推算、不插值、不补值；输出可直接粘进 `src/data/growth-standard-2022.ts`。
录入后还应在测试里抽样回查 PDF 原文（见 tests/growth-percentiles.test.ts）。
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

NUMBER = re.compile(r"^\d+\.\d+$")
AGES = list(range(0, 24)) + list(range(24, 82, 3))  # 44 行，末行 6 岁 9 月龄


def pdf_text(path: Path) -> str:
    if path.suffix.lower() == ".txt":
        return path.read_text(encoding="utf-8")
    with tempfile.NamedTemporaryFile(suffix=".txt") as tmp:
        subprocess.run(
            ["pdftotext", "-layout", str(path), tmp.name],
            check=True,
        )
        return Path(tmp.name).read_text(encoding="utf-8")


def parse_age(label: str) -> int | None:
    compact = label.replace(" ", "").replace("\u00a0", "")
    year = re.fullmatch(r"(\d+)岁(?:(\d+)月)?", compact)
    if year:
        return int(year.group(1)) * 12 + int(year.group(2) or 0)
    month = re.fullmatch(r"(\d+)月", compact)
    return int(month.group(1)) if month else None


def parse_rows(lines: list[str]) -> list[list[float]]:
    rows: list[list[float]] = []
    for line in lines:
        tokens = line.split()
        first = next((i for i, token in enumerate(tokens) if NUMBER.fullmatch(token)), None)
        if first is None:
            continue
        months = parse_age("".join(tokens[:first]))
        if months is None:
            continue
        values = [float(token) for token in tokens[first:] if NUMBER.fullmatch(token)]
        if len(values) != 7:
            raise ValueError(f"年龄 {months} 月这一行不是 7 个百分位：{line.strip()}")
        rows.append([months, *values])
    return rows


def validate(rows: list[list[float]], name: str) -> None:
    months = [int(row[0]) for row in rows]
    if months != AGES:
        raise ValueError(f"{name} 月龄序列不连续或起止不符：{months}")
    for row in rows:
        if len(row) != 8:
            raise ValueError(f"{name} 月龄 {row[0]} 不是 8 列")
        if any(row[i] > row[i + 1] for i in range(1, 7)):
            raise ValueError(f"{name} 月龄 {row[0]} 百分位不是单调不减：{row[1:]}")
    print(f"{name}: {len(rows)} 行，0～81 月龄，7 个百分位，校验通过", file=sys.stderr)


def ts_block(rows: list[list[float]]) -> str:
    def number(value: float) -> str:
        return str(int(value)) if value == int(value) else str(value)

    body = "\n".join(
        "      [" + ", ".join(number(value) for value in row) + "]," for row in rows
    )
    return f"    bmi: [\n{body}\n    ],"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="官方 PDF 或 pdftotext -layout 的 .txt")
    parser.add_argument("--out", type=Path, help="输出 TS 片段；不传则写到 stdout")
    args = parser.parse_args()

    lines = pdf_text(args.source).splitlines()
    starts: dict[str, int] = {}
    for index, line in enumerate(lines):
        # 只认独占一行的表标题：目录、前言里的「见表 A.9」等引用不能当表头。
        title = line.strip()
        if title.startswith("表 A.9") and "男童年龄别 BMI" in title:
            starts.setdefault("male", index)
        if title.startswith("表 A.10") and "女童年龄别 BMI" in title:
            starts.setdefault("female", index)
        if title.startswith("表 A.11"):
            starts.setdefault("end", index)
    for key in ("male", "female", "end"):
        if key not in starts:
            raise ValueError(f"PDF 里找不到表 {key}，请确认下载的是 WS/T 423—2022 全文")
    if not starts["male"] < starts["female"] < starts["end"]:
        raise ValueError("表 A.9 / A.10 / A.11 的顺序不对")

    male = parse_rows(lines[starts["male"] : starts["female"]])
    female = parse_rows(lines[starts["female"] : starts["end"]])
    validate(male, "表 A.9 男童 BMI")
    validate(female, "表 A.10 女童 BMI")
    if len(male) != len(female):
        raise ValueError("男女表行数不一致")

    output = (
        "// 表 A.9 男童年龄别 BMI（0～6 岁 9 月龄，单位 kg/m²）\n"
        + ts_block(male)
        + "\n// 表 A.10 女童年龄别 BMI\n"
        + ts_block(female)
        + "\n"
    )
    if args.out:
        args.out.write_text(output, encoding="utf-8")
        print(f"已写入 {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(output)


if __name__ == "__main__":
    main()
