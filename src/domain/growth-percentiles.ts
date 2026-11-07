import {
  GROWTH_PERCENTILES,
  GROWTH_STANDARD_2022,
  type GrowthMetricId,
  type GrowthPercentile,
  type GrowthSex,
} from "../data/growth-standard-2022.ts";

/**
 * 生长百分位参考：只做查表、相邻两行之间的线性插值与客观区间描述。
 * 数据来自 WS/T 423—2022 附录 A（见 data/growth-standard-2022.ts 的文件头）。
 * 不判断「偏高/偏低」，不给诊断或喂养建议。
 */

/** 图上画这 5 条（表里还有 P10/P90，线太密不好读）。 */
export const SHOWN_PERCENTILES: readonly GrowthPercentile[] = [3, 25, 50, 75, 97];

export interface ReferencePoint {
  months: number;
  value: number;
}
export interface ReferenceLine {
  percentile: GrowthPercentile;
  points: ReferencePoint[];
}

export function referenceAt(
  sex: GrowthSex | undefined,
  metric: GrowthMetricId,
  months: number,
): readonly number[] | undefined {
  if (!sex || !Number.isFinite(months) || months < 0) return undefined;
  const rows = GROWTH_STANDARD_2022[sex][metric];
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  if (months > last[0]!) return undefined;
  if (months <= first[0]!) return first.slice(1);
  let low = first;
  for (const row of rows) {
    if (row[0]! >= months) {
      const span = row[0]! - low[0]!;
      const ratio = span ? (months - low[0]!) / span : 0;
      return GROWTH_PERCENTILES.map(
        (_, index) =>
          low[index + 1]! + (row[index + 1]! - low[index + 1]!) * ratio,
      );
    }
    low = row;
  }
  return last.slice(1);
}

/** 参考线按表中年龄点逐点连线；末端补上图表右边界处的插值点。 */
export function referenceLines(
  sex: GrowthSex | undefined,
  metric: GrowthMetricId,
  maxMonths: number,
): ReferenceLine[] {
  if (!sex || !Number.isFinite(maxMonths)) return [];
  const rows = GROWTH_STANDARD_2022[sex][metric];
  const lastMonth = rows[rows.length - 1]![0]!;
  const end = Math.min(maxMonths, lastMonth);
  const months = [
    ...new Set([...rows.map((row) => row[0]!).filter((m) => m <= end), end]),
  ].sort((a, b) => a - b);
  return SHOWN_PERCENTILES.map((percentile) => {
    const column = GROWTH_PERCENTILES.indexOf(percentile) + 1;
    const points: ReferencePoint[] = [];
    for (const month of months) {
      const values = referenceAt(sex, metric, month);
      if (values) points.push({ months: month, value: values[column - 1]! });
    }
    return { percentile, points };
  }).filter((line) => line.points.length > 1);
}

/** 只写「位于 P…–P… 区间」这类客观描述；没有性别或月龄超出表格范围时返回 null。 */
export function percentileBand(
  sex: GrowthSex | undefined,
  metric: GrowthMetricId,
  months: number,
  value: number,
): string | null {
  const values = referenceAt(sex, metric, months);
  if (!values || !Number.isFinite(value)) return null;
  if (value < values[0]!) return "低于 P3 参考值";
  if (value > values[values.length - 1]!) return "高于 P97 参考值";
  for (let index = 0; index < GROWTH_PERCENTILES.length; index++) {
    if (value === values[index]!) return `约 P${GROWTH_PERCENTILES[index]} 参考值`;
    if (
      index + 1 < values.length &&
      value > values[index]! &&
      value < values[index + 1]!
    )
      return `位于 P${GROWTH_PERCENTILES[index]}–P${GROWTH_PERCENTILES[index + 1]} 区间`;
  }
  return null;
}
