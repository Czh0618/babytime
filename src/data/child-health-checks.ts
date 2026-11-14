/**
 * 0～6 岁儿童健康管理（儿保）日程，共 13 次。
 *
 * 来源：《国家基本公共卫生服务规范（第三版）》「0～6 岁儿童健康管理服务规范」，
 * 国卫基层发〔2017〕13 号，国家卫生计生委 2017-02-28 印发：
 * https://www.nhc.gov.cn/ewebeditor/uploadfile/2017/04/20170417104506514.pdf
 * 2026-11-11 下载官方 PDF 原文逐条核对（服务内容第（一）～（四）节、附件 2 填表说明）。
 *
 * 原文要点：
 * - 新生儿家庭访视：出院后 1 周内（无固定日期，这里只作清单项）；
 * - 新生儿满月健康管理：出生后 28～30 天（按天数，不按自然月）；
 * - 婴幼儿健康管理：3、6、8、12、18、24、30、36 月龄，共 8 次；
 * - 血常规（或血红蛋白）：6～8、18、30 月龄各 1 次（6～8 是区间，不另设 7 月龄）；
 * - 听力筛查：6、12、24、36 月龄各 1 次，第三版原文为「行为测听法」；
 * - 学龄前：4～6 岁每年 1 次，含血常规（或血红蛋白）检测和视力筛查；
 * - 附件 2 填表说明：3 月龄查口腔，6 月龄和 8 月龄按实际出牙数填写。
 * - 早产等高危因素：「根据实际情况增加家庭访视次数」，应用不做矫正、只提示遵医嘱。
 *
 * 本表只写规范里写明的服务节点与项目，不推算具体检查项目结果、不做诊断。
 */

export const HEALTH_CHECK_SOURCE =
  "《国家基本公共卫生服务规范（第三版）》（国卫基层发〔2017〕13 号，2017-02-28 印发）";
export const HEALTH_CHECK_SOURCE_URL =
  "https://www.nhc.gov.cn/ewebeditor/uploadfile/2017/04/20170417104506514.pdf";

/** 健康页固定文案：只描述服务安排，不替代社区卫生服务中心的通知。 */
export const HEALTH_CHECK_FOOTNOTE =
  "依据国家基本公共卫生服务规范，具体以社区卫生服务中心通知为准。";
export const HEALTH_CHECK_RISK_NOTE =
  "早产或有高危因素的宝宝随访更密，按医生安排；这里的日期只作参考，不做矫正。";

export type HealthCheckItemId = "visit" | "measure" | "blood" | "hearing" | "vision" | "oral";

export interface HealthCheckItem {
  id: HealthCheckItemId;
  label: string;
  note?: string;
}

export interface HealthCheckNode {
  id: string;
  label: string;
  /** 参考月龄（按生日加自然月，月末顺延）。 */
  months?: number;
  /** 出生后天数区间，满月用（28～30 天）。 */
  dayRange?: { min: number; max: number };
  /** 没有固定参考日期的清单项（新生儿家庭访视）。 */
  anytime?: boolean;
  /** 界面显示的时间口径。 */
  timing: string;
  /** 6 / 8 月龄可按实际出牙数填写。 */
  teethCount?: boolean;
  items: readonly HealthCheckItem[];
}

const blood = (note?: string): HealthCheckItem => ({
  id: "blood",
  label: "血常规（或血红蛋白）",
  ...(note ? { note } : {}),
});
const hearing: HealthCheckItem = { id: "hearing", label: "听力筛查 · 行为测听法" };
const vision: HealthCheckItem = { id: "vision", label: "视力筛查" };
const oralTeeth: HealthCheckItem = {
  id: "oral",
  label: "口腔 · 按实际出牙数填写",
};

export const CHILD_HEALTH_CHECKS: readonly HealthCheckNode[] = [
  {
    id: "newborn-visit",
    label: "新生儿家庭访视",
    anytime: true,
    timing: "出院后 1 周内",
    items: [{ id: "visit", label: "家庭访视与体格检查" }],
  },
  {
    id: "full-month",
    label: "满月健康管理",
    dayRange: { min: 28, max: 30 },
    timing: "出生后 28～30 天",
    items: [{ id: "measure", label: "体重、身长、头围测量与体格检查" }],
  },
  {
    id: "m3",
    label: "3 月龄",
    months: 3,
    timing: "3 月龄",
    items: [{ id: "oral", label: "口腔检查" }],
  },
  {
    id: "m6",
    label: "6 月龄",
    months: 6,
    timing: "6 月龄",
    teethCount: true,
    items: [
      blood("6～8 月龄期间 1 次"),
      hearing,
      oralTeeth,
    ],
  },
  {
    id: "m8",
    label: "8 月龄",
    months: 8,
    timing: "8 月龄",
    teethCount: true,
    items: [
      blood("与 6 月龄同属 6～8 月龄 1 次"),
      oralTeeth,
    ],
  },
  {
    id: "m12",
    label: "12 月龄",
    months: 12,
    timing: "12 月龄",
    items: [hearing],
  },
  {
    id: "m18",
    label: "18 月龄",
    months: 18,
    timing: "18 月龄",
    items: [blood()],
  },
  {
    id: "m24",
    label: "24 月龄",
    months: 24,
    timing: "24 月龄",
    items: [hearing],
  },
  {
    id: "m30",
    label: "30 月龄",
    months: 30,
    timing: "30 月龄",
    items: [blood()],
  },
  {
    id: "m36",
    label: "36 月龄",
    months: 36,
    timing: "36 月龄",
    items: [hearing],
  },
  {
    id: "y4",
    label: "4 岁",
    months: 48,
    timing: "4 岁（每年 1 次）",
    items: [blood("4～6 岁每年 1 次"), vision],
  },
  {
    id: "y5",
    label: "5 岁",
    months: 60,
    timing: "5 岁（每年 1 次）",
    items: [blood("4～6 岁每年 1 次"), vision],
  },
  {
    id: "y6",
    label: "6 岁",
    months: 72,
    timing: "6 岁（每年 1 次）",
    items: [blood("4～6 岁每年 1 次"), vision],
  },
];
