import type { BabyProfile } from "../types.ts";
import { ageOn } from "../domain/age.ts";

export interface ParentActivity {
  id: string;
  title: string;
  steps: string[];
  sourceUrl: string;
  why?: string;
  pauseWhen?: string;
}

export interface AgeGuide {
  id: string;
  minMonths: number;
  maxMonths?: number;
  label: string;
  focus: string[];
  activities: ParentActivity[];
  sourceUrl: string;
  checkedAt: string;
}

const CHECKED_AT = "2026-11-04";
const CDC = "https://www.cdc.gov/act-early/milestones";
const source = (age: string) => `${CDC}/${age}.html`;
const pause = "宝宝转开、烦躁或累了就停下来，改天再试；活动全程由成人陪伴。";

export const AGE_GUIDES: AgeGuide[] = [
  {
    id: "0-2",
    minMonths: 0,
    maxMonths: 2,
    label: "0–2 个月",
    focus: [
      "可以留意宝宝是否会看向你的脸、在你靠近时有不同反应。",
      "和宝宝说话、抱抱或喂奶时，可以回应他发出的声音和情绪。",
    ],
    activities: [
      {
        id: "0-2-face",
        title: "面对面说话",
        steps: [
          "把脸放在宝宝容易看见的距离。",
          "慢慢说话、微笑，停一下等宝宝的声音或表情。",
          "用简单的词回应，不急着连续逗弄。",
        ],
        sourceUrl: source("2-months"),
        why: "帮助宝宝在日常照护里感受声音、脸和回应。",
        pauseWhen: pause,
      },
      {
        id: "0-2-tummy",
        title: "清醒时的短暂趴卧",
        steps: [
          "在地垫上铺好安全、平整的区域。",
          "宝宝清醒且成人在旁时，让他短暂趴着，玩具放在视线前方。",
          "看到疲惫或不舒服就抱起休息；不用于睡眠。",
        ],
        sourceUrl: source("2-months"),
        why: "CDC 将清醒时趴卧和抬头列为可观察的身体活动。",
        pauseWhen: "只在清醒并有成人持续看护时进行，绝不把趴卧当作睡姿。",
      },
    ],
    sourceUrl: source("2-months"),
    checkedAt: CHECKED_AT,
  },
  {
    id: "2-4",
    minMonths: 2,
    maxMonths: 4,
    label: "2–4 个月",
    focus: [
      "可以留意宝宝是否开始对熟悉的脸和声音有更多回应。",
      "宝宝发声时，可以观察他是否愿意和你轮流发声。",
    ],
    activities: [
      {
        id: "2-4-copy",
        title: "你一句、我一句",
        steps: [
          "等宝宝发出声音。",
          "模仿这个声音，再用清楚的词回应。",
          "停下来给宝宝轮流回应的时间。",
        ],
        sourceUrl: source("4-months"),
        why: "用轮流回应支持早期交流。",
        pauseWhen: pause,
      },
      {
        id: "2-4-picture",
        title: "看图说一说",
        steps: [
          "选一本图画少、颜色清楚的书。",
          "指着一张图，说出简单名称。",
          "观察宝宝的目光和表情，跟着他的兴趣换页。",
        ],
        sourceUrl: source("4-months"),
        why: "把共同注意和语言放进轻松的日常。",
        pauseWhen: pause,
      },
    ],
    sourceUrl: source("4-months"),
    checkedAt: CHECKED_AT,
  },
  {
    id: "4-6",
    minMonths: 4,
    maxMonths: 6,
    label: "4–6 个月",
    focus: [
      "可以留意宝宝是否会伸手拿玩具、用眼睛跟随移动的东西。",
      "游戏中看见宝宝开心或不舒服时，顺着他的反应调整节奏。",
    ],
    activities: [
      {
        id: "4-6-reach",
        title: "伸手够一够",
        steps: [
          "让宝宝在安全地面上躺着或坐在有支撑的位置。",
          "把轻便、适龄的玩具放在伸手可及但需要一点努力的位置。",
          "宝宝拿到后一起看看、说说，不强行拉扯。",
        ],
        sourceUrl: source("4-months"),
        why: "给手眼配合和主动探索留下机会。",
        pauseWhen: pause,
      },
      {
        id: "4-6-floor",
        title: "地面小探索",
        steps: [
          "在清空小物件的地垫上陪宝宝玩。",
          "把玩具放在左右两侧，引导他看向不同方向。",
          "宝宝想休息时结束游戏。",
        ],
        sourceUrl: source("6-months"),
        why: "CDC 建议每天在地面和宝宝一起玩。",
        pauseWhen: pause,
      },
    ],
    sourceUrl: source("6-months"),
    checkedAt: CHECKED_AT,
  },
  {
    id: "6-9",
    minMonths: 6,
    maxMonths: 9,
    label: "6–9 个月",
    focus: [
      "可以留意宝宝是否会对自己的名字、声音或熟悉的人有反应。",
      "宝宝移动、抓取或发声时，观察他想继续还是需要休息。",
    ],
    activities: [
      {
        id: "6-9-turn",
        title: "轮流发声音",
        steps: [
          "宝宝发出一个声音时，先回应同样的声音。",
          "再加上一个简单词，比如‘ba’和‘球’。",
          "等宝宝再回应，形成轻松的来回。",
        ],
        sourceUrl: source("6-months"),
        why: "回应式互动让宝宝体验轮流交流。",
        pauseWhen: pause,
      },
      {
        id: "6-9-roll",
        title: "玩具在前方",
        steps: [
          "让宝宝清醒地在安全地垫上活动。",
          "把熟悉的玩具放在稍微够不到的位置。",
          "用声音和表情鼓励尝试，不强行移动宝宝。",
        ],
        sourceUrl: source("6-months"),
        why: "鼓励宝宝观察、伸手和探索因果。",
        pauseWhen: "清醒时成人在旁，周围没有小物件、线绳或可吞咽物。",
      },
    ],
    sourceUrl: source("6-months"),
    checkedAt: CHECKED_AT,
  },
  {
    id: "9-12",
    minMonths: 9,
    maxMonths: 12,
    label: "9–12 个月",
    focus: [
      "可以留意宝宝是否用手指、声音或动作表达想看的东西。",
      "面对新的人和环境时，观察宝宝的反应并给他熟悉的陪伴。",
    ],
    activities: [
      {
        id: "9-12-hide",
        title: "藏起来，再找找",
        steps: [
          "把熟悉玩具的一部分藏在薄布下面。",
          "用‘在哪里？’引导宝宝找。",
          "找到后一起开心地说出玩具名字。",
        ],
        sourceUrl: source("9-months"),
        why: "peek-a-boo 和寻找游戏支持共同注意与因果探索。",
        pauseWhen: pause,
      },
      {
        id: "9-12-roll",
        title: "我的回合，你的回合",
        steps: [
          "坐在宝宝对面，把软球轻轻滚给他。",
          "等他触碰或推回，再说‘轮到我’。",
          "不要求宝宝按固定方式回应。",
        ],
        sourceUrl: source("9-months"),
        why: "把 CDC 提到的轮流游戏变成简单互动。",
        pauseWhen: pause,
      },
    ],
    sourceUrl: source("9-months"),
    checkedAt: CHECKED_AT,
  },
  {
    id: "12-18",
    minMonths: 12,
    maxMonths: 18,
    label: "12–18 个月",
    focus: [
      "可以留意宝宝是否用手势、声音或词语表达兴趣和需要。",
      "日常中给宝宝简单选择，并观察他是否尝试理解和回应。",
    ],
    activities: [
      {
        id: "12-18-name",
        title: "指一指，说一说",
        steps: [
          "和宝宝一起看熟悉的物品或图书。",
          "指向一个东西，说出它的名字。",
          "等宝宝看、指或发声，再回应他的表达。",
        ],
        sourceUrl: source("1-year"),
        why: "把语言、指向和共同注意放进日常。",
        pauseWhen: pause,
      },
      {
        id: "12-18-container",
        title: "放进去，拿出来",
        steps: [
          "准备一个大而安全的容器和几个不会入口的小物件。",
          "示范把物件放入、倒出，并描述动作。",
          "让宝宝自由尝试，全程在旁看护。",
        ],
        sourceUrl: source("1-year"),
        why: "支持探索动作与简单的因果关系。",
        pauseWhen: "避免可吞咽小物件，宝宝不愿意或把物件放入口中时立即结束。",
      },
    ],
    sourceUrl: source("1-year"),
    checkedAt: CHECKED_AT,
  },
  {
    id: "18-24",
    minMonths: 18,
    maxMonths: 24,
    label: "18–24 个月",
    focus: [
      "可以留意宝宝是否会模仿日常动作、用词语或手势表达想法。",
      "变化或等待时，给出短句和可预测的下一步。",
    ],
    activities: [
      {
        id: "18-24-pretend",
        title: "给玩偶做日常照护",
        steps: [
          "拿一个玩偶和空的小杯子或勺子。",
          "示范‘给娃娃喝水’或‘盖被子’。",
          "让宝宝自己决定接下来怎么演。",
        ],
        sourceUrl: source("18-months"),
        why: "CDC 将简单的假装游戏列为可观察的互动线索。",
        pauseWhen: pause,
      },
      {
        id: "18-24-sort",
        title: "一起收拾两类东西",
        steps: [
          "只选两类明显不同的安全物品。",
          "示范‘车放这里、球放那里’。",
          "让宝宝帮忙放一两个，完成后一起庆祝。",
        ],
        sourceUrl: source("18-months"),
        why: "把简单分类和两步指令变成生活中的合作。",
        pauseWhen: pause,
      },
    ],
    sourceUrl: source("18-months"),
    checkedAt: CHECKED_AT,
  },
  {
    id: "24-36",
    minMonths: 24,
    maxMonths: 36,
    label: "24–36 个月",
    focus: [
      "可以留意宝宝是否开始用更多词语说出需求、兴趣或感受。",
      "游戏中可以给出两步以内的简单说明，再给宝宝自己尝试的时间。",
    ],
    activities: [
      {
        id: "24-36-color",
        title: "按颜色找一找",
        steps: [
          "准备两三种颜色的积木或纸片。",
          "示范把相同颜色放在一起。",
          "让宝宝选择一种颜色继续找，不要求全部正确。",
        ],
        sourceUrl: source("2-years"),
        why: "把颜色和分类放进低压力游戏。",
        pauseWhen: pause,
      },
      {
        id: "24-36-book",
        title: "熟悉的故事接下去",
        steps: [
          "选择宝宝熟悉的短绘本。",
          "读到重复句时停一下，等宝宝用声音、动作或词语回应。",
          "如果宝宝想翻页，就跟着他的兴趣。",
        ],
        sourceUrl: source("2-years"),
        why: "在共同阅读里支持表达和轮流。",
        pauseWhen: pause,
      },
    ],
    sourceUrl: source("2-years"),
    checkedAt: CHECKED_AT,
  },
  {
    id: "36-48",
    minMonths: 36,
    maxMonths: 48,
    label: "36–48 个月",
    focus: [
      "可以留意宝宝是否愿意用语言讲述想法、感受和正在玩的故事。",
      "和同伴或成人游戏时，观察他如何轮流、合作和表达需要。",
    ],
    activities: [
      {
        id: "36-48-pretend",
        title: "一起编一个小故事",
        steps: [
          "让宝宝选一个玩偶或日常物品当主角。",
          "问‘它现在要去哪里？’并接受宝宝的想法。",
          "你只补一句，轮流把故事继续下去。",
        ],
        sourceUrl: source("3-years"),
        why: "CDC 将假装游戏、讲述和理解简单指令列为可观察线索。",
        pauseWhen: pause,
      },
      {
        id: "36-48-puzzle",
        title: "三四块拼图时间",
        steps: [
          "选宝宝熟悉主题的简单拼图。",
          "先让宝宝自己试，再用问题提示形状或图案。",
          "宝宝需要帮助时给一点提示，不代替完成。",
        ],
        sourceUrl: source("3-years"),
        why: "让问题解决成为共同游戏。",
        pauseWhen: pause,
      },
    ],
    sourceUrl: source("3-years"),
    checkedAt: CHECKED_AT,
  },
  {
    id: "48-60",
    minMonths: 48,
    maxMonths: 60,
    label: "48–60 个月",
    focus: [
      "可以留意宝宝是否会讲述经历、说出兴趣，并尝试遵守熟悉游戏的规则。",
      "给宝宝机会解释自己的想法，也可以邀请他描述接下来会发生什么。",
    ],
    activities: [
      {
        id: "48-60-story",
        title: "三张图讲故事",
        steps: [
          "选三张简单图片，和宝宝一起排顺序。",
          "请宝宝说说发生了什么。",
          "你可以复述并补充一个问题，不纠正故事的想象部分。",
        ],
        sourceUrl: source("4-years"),
        why: "支持叙述、顺序和想象表达。",
        pauseWhen: pause,
      },
      {
        id: "48-60-same",
        title: "找相同和不同",
        steps: [
          "拿两件相似又不完全相同的物品。",
          "一起找颜色、形状或用途的相同点。",
          "再让宝宝找一个不同点。",
        ],
        sourceUrl: source("4-years"),
        why: "把比较和语言表达放进熟悉物品。",
        pauseWhen: pause,
      },
    ],
    sourceUrl: source("4-years"),
    checkedAt: CHECKED_AT,
  },
  {
    id: "60+",
    minMonths: 60,
    label: "60 个月以上",
    focus: [
      "可以留意宝宝是否愿意讲清楚自己的想法、故事和兴趣。",
      "在合作游戏里，观察宝宝如何轮流、遵守约定并表达感受。",
    ],
    activities: [
      {
        id: "60-game",
        title: "简单桌游一起玩",
        steps: [
          "选择规则短、回合清楚的卡牌或棋类游戏。",
          "先示范一回合，再邀请宝宝轮流。",
          "把重点放在一起玩，不把输赢变成评价。",
        ],
        sourceUrl: source("5-years"),
        why: "CDC 提到 5 岁儿童可参与简单的棋类或卡牌游戏。",
        pauseWhen: pause,
      },
      {
        id: "60-draw",
        title: "画一张‘今天的我’",
        steps: [
          "给宝宝纸和彩笔，让他画今天想记住的事。",
          "请他讲讲画面中的人、地点或故事。",
          "把宝宝的原话记下来，除非他主动要求，不代替修改。",
        ],
        sourceUrl: source("5-years"),
        why: "把表达、讲述和家庭记忆连起来。",
        pauseWhen: pause,
      },
    ],
    sourceUrl: source("5-years"),
    checkedAt: CHECKED_AT,
  },
];

export function guideForAge(months: number): AgeGuide {
  return (
    AGE_GUIDES.find(
      (guide) =>
        months >= guide.minMonths &&
        (guide.maxMonths === undefined || months < guide.maxMonths),
    ) ?? AGE_GUIDES[0]!
  );
}

export function guideForBaby(
  baby: BabyProfile,
  today?: string,
): { age: ReturnType<typeof ageOn>; guide: AgeGuide } {
  const age = ageOn(baby.birthDate, today);
  return { age, guide: guideForAge(age.valid ? age.months : 0) };
}
