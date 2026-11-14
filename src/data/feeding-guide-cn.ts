/**
 * 喂养准则与口腔提示，只录已核实的原文条目。
 *
 * 喂养：《中国居民膳食指南（2022）》（中国营养学会）0～6 月龄、7～24 月龄
 * 各 6 条准则标题。官方核心信息页（2022-06-02 发布）以图示给出：
 * https://dg.cnsoc.org/article/04/gc5cUak3RhSGheqSaRljnA.html
 * 标题文字与东莞市卫生健康局转录页互核：
 * https://dghb.dg.gov.cn/zsjg/dzsjbyfkzzx/ztzl/yyeyyzl/yyeyyzl/post_3962200.html
 * 2026-11-11 核对。只写准则标题，不写用量、不写维生素 D 剂量。
 *
 * 新食物「观察几天」：中国营养学会官网《7～24 月龄婴幼儿喂养指南》原文写
 * 「每引入一种新的食物应适应 2～3 天，密切观察是否出现呕吐、腹泻、皮疹等
 * 不良反应，适应一种食物后再添加其他新的食物」：
 * https://dg.cnsoc.org/article/04/8a2389fd5520b4f30155a5d4d78621c4.html
 * 该篇 2015-12-12 发布（对应 2016 版指南）；2022 版官方核心信息页是图片、
 * 没有文字表述，北京疾控 2022 版科普沿用同一数字。因此应用里只作带出处与
 * 版本说明的描述性提示，不做倒计时、不判断是否达标。
 *
 * 口腔：《中国居民口腔健康指南》（国家卫生健康委员会 / 原卫生部，2009）：
 * https://www.nhc.gov.cn/wjw/jkshfs/200909/058b3e9ade454a3f9f8bfe807ae78aaa.shtml
 * 及《国家基本公共卫生服务规范（第三版）》附件 2 填表说明（6、8 月龄按实际
 * 出牙数填写）。乳牙萌出时间表按 P8.0 / 3.1 定稿本期不做，不录入。
 */

export const FEEDING_SOURCE =
  "《中国居民膳食指南（2022）》（中国营养学会）0～6 月龄与 7～24 月龄婴幼儿喂养指南";
export const FEEDING_SOURCE_URL =
  "https://dg.cnsoc.org/article/04/gc5cUak3RhSGheqSaRljnA.html";
export const NEW_FOOD_SOURCE =
  "中国营养学会官网《7～24 月龄婴幼儿喂养指南》（2015-12-12 发布，对应 2016 版）";
export const NEW_FOOD_SOURCE_URL =
  "https://dg.cnsoc.org/article/04/8a2389fd5520b4f30155a5d4d78621c4.html";
export const ORAL_SOURCE =
  "《中国居民口腔健康指南》（国家卫生健康委员会，2009）与《国家基本公共卫生服务规范（第三版）》附件 2";
export const ORAL_SOURCE_URL =
  "https://www.nhc.gov.cn/wjw/jkshfs/200909/058b3e9ade454a3f9f8bfe807ae78aaa.shtml";

export interface FeedingGuide {
  id: string;
  label: string;
  minMonths: number;
  maxMonths: number;
  items: readonly string[];
}

export const FEEDING_GUIDES: readonly FeedingGuide[] = [
  {
    id: "0-6",
    label: "0～6 月龄",
    minMonths: 0,
    maxMonths: 6,
    items: [
      "母乳是婴儿最理想的食物，坚持 6 月龄内纯母乳喂养",
      "生后 1 小时内开奶，重视尽早吸吮",
      "回应式喂养，建立良好的生活规律",
      "适当补充维生素 D，母乳喂养无需补钙",
      "一旦有任何动摇母乳喂养的想法和举动，都必须咨询医生或其他专业人员，并由他们帮助做出决定",
      "定期监测婴儿体格指标，保持健康生长",
    ],
  },
  {
    id: "7-24",
    label: "7～24 月龄",
    minMonths: 7,
    maxMonths: 24,
    items: [
      "继续母乳喂养，满 6 月龄起必须添加辅食，从富含铁的泥糊状食物开始",
      "及时引入多样化食物，重视动物性食物的添加",
      "尽量少加糖盐，油脂适当，保持食物原味",
      "提倡回应式喂养，鼓励但不强迫进食",
      "注意饮食卫生和进食安全",
      "定期监测体格指标，追求健康生长",
    ],
  },
];

/** 按完整月龄选一组；超过 24 月龄不显示（这组准则只覆盖到 2 岁）。 */
export function feedingGuideFor(months: number): FeedingGuide | undefined {
  if (!Number.isFinite(months) || months < 0) return undefined;
  const complete = Math.floor(months);
  return FEEDING_GUIDES.find(
    (guide) => complete >= guide.minMonths && complete <= guide.maxMonths,
  );
}

/** 只描述首次引入与出处，不做倒计时、不判断是否达标。 */
export const NEW_FOOD_OBSERVATION_NOTE =
  "中国营养学会《7～24 月龄婴幼儿喂养指南》原文提到：每引入一种新的食物应适应 2～3 天，密切观察是否出现不良反应，适应一种食物后再添加其他新的食物。这里只记首次吃的日期，不计时、不判断，具体请以医生为准。";
export const NEW_FOOD_VERSION_NOTE =
  "注：这句数字出自中国营养学会官网 2016 版指南原文；2022 版官方核心信息以图示发布、未见文字数字，北京疾控 2022 版科普沿用同一说法。";

export const ORAL_CARE_TIPS: readonly string[] = [
  "第一颗牙萌出后 6 个月内做第一次口腔检查，之后每半年检查一次",
  "多颗牙萌出后每天刷牙 2 次",
  "1 岁后减少使用奶瓶，1 岁半～2 岁停用",
  "6、8 月龄体检时按实际出牙数填写（规范附件 2）",
];

export const ORAL_CARE_FOOTNOTE =
  "这里只列官方指南的日常提示，不做乳牙萌出时间表，具体请以医生为准。";
