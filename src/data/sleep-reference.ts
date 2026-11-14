/**
 * WS/T 579—2017《0 岁～5 岁儿童睡眠卫生指南》附录 A：24 小时总睡眠时间参考值。
 *
 * 来源：国家卫生健康委员会（原国家卫生计生委）发布的卫生行业标准 PDF 附录 A，
 * 2017-10-12 发布、2018-04-01 实施；2026-11-11 对照 nhc.gov.cn 原文核实。
 *
 * 原文给的是「24 小时总睡眠时间（含白天小睡）」的参考范围，四档按年龄划分。
 * 标准对范围之外的情况写「提示需要进一步医学评估」；本应用只展示参考范围，
 * 不拿记录值做对照、不判断是否充足，也不照搬这句评估措辞。
 */

export const SLEEP_REFERENCE_SOURCE =
  "WS/T 579—2017《0 岁～5 岁儿童睡眠卫生指南》附录 A（国家卫生健康委员会，2018-04-01 实施）";

export interface SleepReference {
  id: string;
  label: string;
  /** 完整月龄下界（含）。 */
  minMonths: number;
  /** 完整月龄上界（含）。 */
  maxMonths: number;
  minHours: number;
  maxHours: number;
}

export const SLEEP_REFERENCES: readonly SleepReference[] = [
  { id: "0-3", label: "0～3 月龄", minMonths: 0, maxMonths: 3, minHours: 13, maxHours: 18 },
  { id: "4-11", label: "4～11 月龄", minMonths: 4, maxMonths: 11, minHours: 12, maxHours: 16 },
  { id: "12-35", label: "1～2 岁", minMonths: 12, maxMonths: 35, minHours: 11, maxHours: 14 },
  { id: "36-71", label: "3～5 岁", minMonths: 36, maxMonths: 71, minHours: 10, maxHours: 13 },
];

/** 按完整月龄取档；72 月龄（6 岁）起超出标准覆盖年龄，不再显示。 */
export function sleepReferenceFor(months: number): SleepReference | null {
  if (!Number.isFinite(months) || months < 0 || months >= 72) return null;
  const complete = Math.floor(months);
  return (
    SLEEP_REFERENCES.find(
      (item) => complete >= item.minMonths && complete <= item.maxMonths,
    ) ?? null
  );
}

/** 只描述参考范围，不比较记录值。 */
export function sleepReferenceText(item: SleepReference): string {
  return `该月龄 24 小时总睡眠参考 ${item.minHours}～${item.maxHours} 小时（含白天小睡）`;
}

/** 今日卡片与趋势图共用；说明数据边界，避免把参考范围读成判断。 */
export const SLEEP_REFERENCE_DISCLAIMER =
  "参考范围只作描述，不与记录值对比；记录可能不全，具体请以医生为准。";

/** 趋势图参考带的说明：只画已过完的日子，今天还没过完不参与对照。 */
export const SLEEP_REFERENCE_BAND_HINT =
  "阴影只画在已过完的日子上，今天未过完不画；只作参考，不判断是否达到范围。";
