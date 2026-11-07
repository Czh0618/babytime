/**
 * 国家免疫规划疫苗儿童免疫程序（2026 年版）静态数据。
 * 来源：《国家免疫规划疫苗儿童免疫程序及说明（2026 年版）》，
 * 国家疾控局、国家卫生健康委 2026-06 印发。
 * 剂次与月龄按 ROADMAP 中已与该文件第二部分逐条核对的表格录入。
 * 本文件不做任何判断，只描述程序；具体以接种门诊与接种证为准。
 */

export interface VaccineDoseSpec {
  /** 第几剂，从 1 开始。 */
  dose: number;
  /** 应种月龄（自然月），0 表示出生时。 */
  months: number;
  /** 相对上一剂的额外天数（如乙脑灭活第 2 剂间隔 7–10 天）。 */
  daysAfterPrevious?: number;
  /** 相对上一剂的月数（如 HPV 第 2 剂间隔 6 个月）。 */
  monthsAfterPrevious?: number;
  note?: string;
}

export interface VaccineSpec {
  /** 缩写，写入记录。 */
  code: string;
  name: string;
  /** 二选一的分组：乙脑、甲肝。 */
  group?: "je" | "hepatitis-a";
  /** 仅女孩接种。 */
  femaleOnly?: boolean;
  doses: VaccineDoseSpec[];
}

const dose = (
  index: number,
  months: number,
  extra: Partial<VaccineDoseSpec> = {},
): VaccineDoseSpec => ({ dose: index, months, ...extra });

export const VACCINES_2026: readonly VaccineSpec[] = [
  {
    code: "HepB",
    name: "乙肝疫苗",
    doses: [
      dose(1, 0, { note: "出生 24 小时内" }),
      dose(2, 1),
      dose(3, 6),
    ],
  },
  { code: "BCG", name: "卡介苗", doses: [dose(1, 0, { note: "出生时" })] },
  { code: "IPV", name: "脊灰灭活疫苗", doses: [dose(1, 2), dose(2, 3)] },
  { code: "bOPV", name: "脊灰减毒活疫苗", doses: [dose(1, 4), dose(2, 48)] },
  {
    code: "DTaP",
    name: "百白破疫苗",
    doses: [dose(1, 2), dose(2, 4), dose(3, 6), dose(4, 18), dose(5, 72)],
  },
  { code: "MMR", name: "麻腮风疫苗", doses: [dose(1, 8), dose(2, 18)] },
  {
    code: "JE-L",
    name: "乙脑减毒活疫苗",
    group: "je",
    doses: [dose(1, 8), dose(2, 24)],
  },
  {
    code: "JE-I",
    name: "乙脑灭活疫苗",
    group: "je",
    doses: [
      dose(1, 8),
      dose(2, 8, { daysAfterPrevious: 10, note: "与第 1 剂间隔 7–10 天" }),
      dose(3, 24),
      dose(4, 72),
    ],
  },
  { code: "MPSV-A", name: "A 群流脑多糖疫苗", doses: [dose(1, 6), dose(2, 9)] },
  {
    code: "MPSV-AC",
    name: "A 群 C 群流脑多糖疫苗",
    doses: [dose(1, 36), dose(2, 72)],
  },
  {
    code: "HepA-L",
    name: "甲肝减毒活疫苗",
    group: "hepatitis-a",
    doses: [dose(1, 18)],
  },
  {
    code: "HepA-I",
    name: "甲肝灭活疫苗",
    group: "hepatitis-a",
    doses: [dose(1, 18), dose(2, 24)],
  },
  {
    code: "2vHPV",
    name: "双价 HPV 疫苗",
    femaleOnly: true,
    doses: [dose(1, 156), dose(2, 156, { monthsAfterPrevious: 6 })],
  },
];

/** 乙肝特殊程序：母亲 HBsAg 阳性且出生体重 <2000g。 */
export const HEPB_SPECIAL_DOSES: readonly VaccineDoseSpec[] = [
  dose(1, 0),
  dose(2, 1),
  dose(3, 2),
  dose(4, 7),
];

/** 语音里常见的说法 → 程序内缩写；找不到就当作自费/自定义疫苗。 */
export const VACCINE_ALIASES: ReadonlyArray<{
  pattern: RegExp;
  code: string;
}> = [
  { pattern: /百白破|白百破|三联/, code: "DTaP" },
  { pattern: /乙肝/, code: "HepB" },
  { pattern: /卡介/, code: "BCG" },
  { pattern: /脊灰.*减毒|糖丸|bopv/i, code: "bOPV" },
  { pattern: /脊灰|小儿麻痹|ipv/i, code: "IPV" },
  { pattern: /麻腮风|麻风|腮腺炎|麻疹/, code: "MMR" },
  { pattern: /乙脑/, code: "JE-L" },
  { pattern: /流脑.*[aA]\s*群?\s*[cC]|ac 流脑|ac流脑/, code: "MPSV-AC" },
  { pattern: /流脑/, code: "MPSV-A" },
  { pattern: /甲肝/, code: "HepA-L" },
  { pattern: /hpv|宫颈癌/i, code: "2vHPV" },
];

export const VACCINE_BY_CODE: Readonly<Record<string, VaccineSpec>> =
  Object.fromEntries(VACCINES_2026.map((item) => [item.code, item]));

export const VACCINE_SOURCE =
  "依据《国家免疫规划疫苗儿童免疫程序及说明（2026 年版）》，具体以接种门诊和接种证为准。";

export function vaccineForCode(code: string): VaccineSpec | undefined {
  return VACCINE_BY_CODE[code];
}

/** 从一句原话里认出疫苗缩写；认不出返回 undefined。 */
export function matchVaccine(text: string): VaccineSpec | undefined {
  for (const alias of VACCINE_ALIASES)
    if (alias.pattern.test(text)) return VACCINE_BY_CODE[alias.code];
  return undefined;
}
