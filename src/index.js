const { db, ggckWordsRef } = require("./db/firebase");
const { isAdmin, setAdmin } = require("./db/firebase");
const { Timestamp } = require("firebase-admin/firestore");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");
const dotenv = require("dotenv");

// 피파 API 관련 상수
const FCONLINE_API_KEY = process.env.FCONLINE_API_KEY;

// 1. 피파 온라인 API 호출 함수 추가
// 닉네임으로 OUID 조회
async function getFifaOUID(nickname) {
  try {
    const encodedNickname = encodeURIComponent(nickname);
    const response = await axios.get(
      `https://open.api.nexon.com/fconline/v1/id?nickname=${encodedNickname}`,
      {
        headers: { "x-nxopen-api-key": process.env.FCONLINE_API_KEY },
      },
    );
    console.log("OUID 응답 데이터:", JSON.stringify(response.data));

    // 객체에서 ouid 속성 추출하여 반환
    if (response.data && response.data.ouid) {
      return response.data.ouid;
    } else {
      console.error("OUID를 찾을 수 없음:", response.data);
      return null;
    }
  } catch (error) {
    console.error("피파 OUID 조회 중 에러:", error.message);
    if (error.response && error.response.data) {
      console.error(
        "응답 에러 상세 정보:",
        JSON.stringify(error.response.data),
      );
    }
    throw error;
  }
}

// 기본 유저 정보 조회
async function getFifaUserInfo(ouid) {
  try {
    console.log(`유저 정보 API 호출 (OUID: ${ouid})`);
    const response = await axios.get(
      `https://open.api.nexon.com/fconline/v1/user/basic?ouid=${ouid}`,
      {
        headers: { "x-nxopen-api-key": process.env.FCONLINE_API_KEY },
      },
    );
    console.log("유저 정보 응답 데이터:", JSON.stringify(response.data));
    return response.data;
  } catch (error) {
    console.error("피파 유저 정보 조회 중 에러:", error.message);
    if (error.response && error.response.data) {
      console.error(
        "응답 에러 상세 정보:",
        JSON.stringify(error.response.data),
      );
    }
    throw error;
  }
}

// 최고 등급 정보 조회
async function getFifaMaxDivision(ouid) {
  try {
    console.log(`최고 등급 API 호출 (OUID: ${ouid})`);
    const response = await axios.get(
      `https://open.api.nexon.com/fconline/v1/user/maxdivision?ouid=${ouid}`,
      {
        headers: { "x-nxopen-api-key": process.env.FCONLINE_API_KEY },
      },
    );
    console.log("최고 등급 응답 데이터:", JSON.stringify(response.data));
    return response.data;
  } catch (error) {
    console.error("피파 최고 등급 정보 조회 중 에러:", error.message);
    if (error.response && error.response.data) {
      console.error(
        "응답 에러 상세 정보:",
        JSON.stringify(error.response.data),
      );
    }
    throw error;
  }
}

// 디비전(티어) 이름 반환 함수
function getDivisionName(division) {
  const divisionNames = {
    800: "슈퍼챔피언스",
    900: "챔피언스",
    1000: "슈퍼챌린지",
    1100: "챌린지1",
    1200: "챌린지2",
    1300: "챌린지3",
    2000: "월드클래스1",
    2100: "월드클래스2",
    2200: "월드클래스3",
    2300: "프로1",
    2400: "프로2",
    2500: "프로3",
    2600: "세미프로1",
    2700: "세미프로2",
    2800: "세미프로3",
    2900: "아마추어1",
    3000: "아마추어2",
    3100: "아마추어3",
  };

  return divisionNames[division] || `알 수 없음(${division})`;
}

// 매치 타입 이름 반환 함수
function getMatchTypeName(matchType) {
  const matchTypeNames = {
    50: "공식경기",
    52: "감독모드",
    40: "친선경기",
    60: "볼타모드",
  };

  return matchTypeNames[matchType] || `기타(${matchType})`;
}

// Riot API 관련 상수
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const TFT_API_BASE = "https://kr.api.riotgames.com/tft";
const LEAGUE_API_BASE = `${TFT_API_BASE}/league/v1`;
const MATCH_API_BASE = `${TFT_API_BASE}/match/v1`;
// Riot API 관련 추가 상수
const GRANDMASTER_API_PATH = `${LEAGUE_API_BASE}/grandmaster`;

// Riot API 관련 상수 아래에 추가
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6시간
const statsCache = new Map();

// API 요청 관리를 위한 Rate Limiter 클래스
class RiotRateLimiter {
  constructor() {
    // 메소드별 Rate Limit 추적
    this.methodLimits = {
      "tft/league/v1": {
        count: 0,
        lastReset: Date.now(),
        limit: 50,
        interval: 60000,
      },
      "tft/match/v1": {
        count: 0,
        lastReset: Date.now(),
        limit: 100,
        interval: 120000,
      },
      "tft/summoner/v1": {
        count: 0,
        lastReset: Date.now(),
        limit: 20,
        interval: 60000,
      },
      default: { count: 0, lastReset: Date.now(), limit: 20, interval: 60000 },
    };

    // 전역 App Rate Limit
    this.appLimit = {
      count: 0,
      lastReset: Date.now(),
      limit: 100,
      interval: 120000,
    };

    // 주기적으로 카운터 리셋
    setInterval(() => this.resetCounters(), 60000);
  }

  resetCounters() {
    const now = Date.now();

    // 각 메소드별 카운터 리셋
    for (const method in this.methodLimits) {
      const limit = this.methodLimits[method];
      if (now - limit.lastReset >= limit.interval) {
        limit.count = 0;
        limit.lastReset = now;
      }
    }

    // 앱 전체 카운터 리셋
    if (now - this.appLimit.lastReset >= this.appLimit.interval) {
      this.appLimit.count = 0;
      this.appLimit.lastReset = now;
    }
  }

  async checkAndWait(methodPath, retryCount = 0) {
    // 최대 재시도 횟수(3회) 확인
    if (retryCount >= 3) {
      console.error(`Rate Limiter 최대 재시도 횟수(3회) 초과: ${methodPath}`);
      throw new Error(`Rate Limit 대기 시간 초과 (최대 재시도 횟수 초과)`);
    }

    // API 메소드 경로에서 기본 경로 추출 (예: tft/match/v1)
    const baseMethod = methodPath.split("/").slice(0, 3).join("/") || "default";
    const methodLimit =
      this.methodLimits[baseMethod] || this.methodLimits.default;

    // 메소드별 Rate Limit 체크
    if (methodLimit.count >= methodLimit.limit) {
      const waitTime =
        methodLimit.interval - (Date.now() - methodLimit.lastReset);
      if (waitTime > 0) {
        console.log(
          `Method Rate Limit reached for ${baseMethod}, waiting ${waitTime}ms (재시도: ${retryCount + 1}/3)`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.checkAndWait(methodPath, retryCount + 1); // 재시도 횟수 증가
      }
      methodLimit.count = 0;
      methodLimit.lastReset = Date.now();
    }

    // 앱 전체 Rate Limit 체크
    if (this.appLimit.count >= this.appLimit.limit) {
      const waitTime =
        this.appLimit.interval - (Date.now() - this.appLimit.lastReset);
      if (waitTime > 0) {
        console.log(
          `App Rate Limit reached, waiting ${waitTime}ms (재시도: ${retryCount + 1}/3)`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.checkAndWait(methodPath, retryCount + 1); // 재시도 횟수 증가
      }
      this.appLimit.count = 0;
      this.appLimit.lastReset = Date.now();
    }

    // 카운터 증가
    methodLimit.count++;
    this.appLimit.count++;
  }
}

// Riot API 요청 유틸리티 함수
async function makeRiotRequest(url, retryCount = 0) {
  try {
    const response = await axios.get(url, {
      headers: { "X-Riot-Token": process.env.RIOT_API_KEY },
    });
    return response.data;
  } catch (error) {
    // 최대 재시도 횟수(3회) 확인
    if (retryCount >= 3) {
      console.error(`최대 재시도 횟수(3회) 초과: ${url}`);
      throw new Error(
        `API 요청 실패 (최대 재시도 횟수 초과): ${error.message}`,
      );
    }

    if (error.response?.status === 429) {
      // Rate limit exceeded - wait and retry
      const retryAfter = error.response.headers["retry-after"] || 1;
      console.log(
        `Rate limit 도달, ${retryAfter}초 후 재시도 (${retryCount + 1}/3)`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return makeRiotRequest(url, retryCount + 1); // 재시도 횟수 증가
    }
    throw error;
  }
}

// 아이템 통계를 저장할 Firebase 컬렉션
const tftStatsRef = db.collection("tftStats");

// JSON 파일 불러오기
const championMapping = JSON.parse(
  fs.readFileSync(path.join(__dirname, "./data/tftChampions.json"), "utf8"),
);
const itemMapping = JSON.parse(
  fs.readFileSync(path.join(__dirname, "./data/tftItems.json"), "utf8"),
);

// TFT 아이템 커맨드에서 사용할 자동완성 선택지 생성
const championChoices = Object.keys(championMapping).map((name) => ({
  name: name,
  value: name,
}));

// 네이버 지도 API 관련 상수
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

// 현재 한국 시간 Date 객체 가져오기
function getCurrentKoreanDate() {
  const utcNow = new Date();
  return new Date(utcNow.getTime());
}

// Date 객체를 Firebase Timestamp로 변환 (UTC 기준)
function getKoreanTimestamp(date) {
  const utcTime = new Date(date.getTime());
  return Timestamp.fromDate(utcTime);
}

// Firebase Timestamp를 한국 시간 Date 객체로 변환
function koreanDateFromTimestamp(timestamp) {
  const utcDate = timestamp.toDate();
  return new Date(utcDate.getTime());
}

// 게임 예약 시간 설정 함수
function createScheduledTime(hour, minute) {
  const koreanNow = getCurrentKoreanDate();

  // 한국 시간으로 예약 시간 설정
  const scheduledDate = new Date(
    koreanNow.getFullYear(),
    koreanNow.getMonth(),
    koreanNow.getDate(),
    hour,
    minute,
    0,
  );

  // 예약 시간에서 9시간 빼기
  const adjustedScheduled = new Date(
    scheduledDate.getTime() - 9 * 60 * 60 * 1000,
  );

  // 현재 시간보다 이전인 경우 다음 날로 설정
  const utcNow = new Date();
  if (adjustedScheduled.getTime() <= utcNow.getTime()) {
    adjustedScheduled.setDate(adjustedScheduled.getDate() + 1);
  }

  return adjustedScheduled;
}

// 시간 유효성 검사 함수
function isValidTime(scheduledDate) {
  const koreanNow = getCurrentKoreanDate();
  const minTime = new Date(koreanNow.getTime() + 10 * 60 * 1000); // 현재 시간 + 10분
  return scheduledDate.getTime() > minTime.getTime();
}

// 전역 시간 포맷팅 함수
const formatTime = (date) => {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul", // 명시적으로 한국 시간대 지정
  }).format(date);
};

// 디버그용 시간 로깅 함수
function logTimeInfo(scheduledDate) {
  const koreanNow = getCurrentKoreanDate();

  console.log(
    "현재 한국 시간:",
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", // 명시적으로 한국 시간대 지정
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(koreanNow),
  );

  console.log(
    "예약된 시간:",
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", // 명시적으로 한국 시간대 지정
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(scheduledDate),
  );

  console.log(
    "시간 차이(분):",
    Math.round((scheduledDate.getTime() - koreanNow.getTime()) / (1000 * 60)),
  );
}

// 날씨 아이콘 매핑
const weatherIcons = {
  "01d": "☀️", // 맑음 (낮)
  "01n": "🌙", // 맑음 (밤)
  "02d": "⛅", // 약간 흐림 (낮)
  "02n": "☁️", // 약간 흐림 (밤)
  "03d": "☁️", // 흐림
  "03n": "☁️",
  "04d": "☁️", // 매우 흐림
  "04n": "☁️",
  "09d": "🌧️", // 소나기
  "09n": "🌧️",
  "10d": "🌦️", // 비 (낮)
  "10n": "🌧️", // 비 (밤)
  "11d": "⛈️", // 천둥번개
  "11n": "⛈️",
  "13d": "🌨️", // 눈
  "13n": "🌨️",
  "50d": "🌫️", // 안개
  "50n": "🌫️",
};

// getRandomItem 유틸리티 함수 추가
function getRandomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// 운세 데이터
const fortuneData = {
  // 운세 등급과 확률 (총합 100)
  grades: [
    { grade: "태초", probability: 3, color: "#FFFFFF", emoji: "✨" },
    { grade: "대길", probability: 7, color: "#FF0000", emoji: "🔱" },
    { grade: "중길", probability: 15, color: "#FFA500", emoji: "🌟" },
    { grade: "소길", probability: 25, color: "#FFFF00", emoji: "⭐" },
    { grade: "평범", probability: 25, color: "#C0C0C0", emoji: "🔄" },
    { grade: "흉", probability: 15, color: "#A9A9A9", emoji: "⚠️" },
    { grade: "대흉", probability: 7, color: "#4A4A4A", emoji: "💀" },
    { grade: "존망", probability: 3, color: "#000000", emoji: "☠️" },
  ],
  advice: {
    // 피해야 할 것들
    avoid: [
      "과식",
      "충동구매",
      "늦잠",
      "음주",
      "불필요한 다툼",
      "우산 없이 외출",
      "즉흥적인 결정",
      "뒷담화",
      "무리한 운동",
      "게임",
      "SNS",
      "야식",
      "긴 회의",
      "도박",
      "험한 말",
      "고집부리기",
      "과도한 카페인",
      "불평하기",
      "약속 취소",
      "지나친 간식",
      "비관적 생각",
      "소셜미디어 논쟁",
      "오래된 감정에 사로잡히기",
      "지출 영수증 버리기",
      "감정적 이메일 보내기",
      "스마트폰 과다사용",
      "건강에 해로운 음식",
      "방 어지럽히기",
      "불필요한 회의",
      "약속 시간에 늦기",
      "남의 말 끊기",
      "무리한 계획 세우기",
      "과한 자기비판",
      "중요한 일 미루기",
      "건강 체크 미루기",
    ],
    // 해야 할 것들
    do: [
      "운동",
      "독서",
      "명상",
      "산책",
      "친구와의 대화",
      "가족과의 시간",
      "새로운 도전",
      "청소",
      "일찍 기상",
      "물 많이 마시기",
      "스트레칭",
      "일기쓰기",
      "봉사활동",
      "저축",
      "칭찬하기",
      "감사일기 쓰기",
      "플랜트 케어",
      "새로운 레시피 시도",
      "좋아하는 음악 듣기",
      "비타민 섭취",
      "목표 리스트 작성",
      "단백질 챙겨먹기",
      "충분한 햇빛 쬐기",
      "심호흡하기",
      "오래된 친구에게 연락하기",
      "집 정리정돈",
      "새로운 기술 배우기",
      "적절한 휴식",
      "재활용 실천하기",
      "유산소 운동",
      "올바른 자세 유지하기",
      "좋은 책 한 권 읽기",
      "포용적인 태도 갖기",
      "긍정적인 단어 사용하기",
      "작은 성취 축하하기",
    ],
  },
  // 각 분야별 메시지
  categories: {
    study: {
      태초: [
        "우주의 지식이 당신에게 흘러들어옵니다",
        "초월적인 깨달음으로 모든 것이 명확해질 것입니다",
      ],
      대길: [
        "공부한 모든 것이 완벽하게 이해될 것입니다",
        "놀라운 집중력으로 큰 성과를 이룰 수 있습니다",
      ],
      중길: [
        "꾸준한 노력이 결실을 맺을 것입니다",
        "새로운 지식을 얻을 좋은 기회가 있습니다",
      ],
      소길: [
        "평소처럼 진행하면 무난한 결과가 있을 것입니다",
        "복습이 도움이 될 것입니다",
      ],
      평범: [
        "특별한 변화는 없지만 꾸준함이 중요합니다",
        "기본에 충실하면 점차 나아질 것입니다",
      ],
      흉: [
        "집중력이 떨어질 수 있으니 주의하세요",
        "기초부터 다시 점검해보는 것이 좋습니다",
      ],
      대흉: [
        "실수하기 쉬운 날입니다. 모든 것을 꼼꼼히 확인하세요",
        "무리한 계획은 피하는 것이 좋습니다",
      ],
      존망: [
        "모든 노력이 수포로 돌아갈 것입니다",
        "오늘은 아무것도 배우지 못할 것입니다",
      ],
    },
    work: {
      태초: [
        "당신의 업적이 역사에 기록될 것입니다",
        "세상을 변화시킬 혁신을 이룰 것입니다",
      ],
      대길: [
        "큰 성과를 이룰 수 있는 날입니다",
        "승진이나 좋은 기회가 찾아올 수 있습니다",
      ],
      중길: [
        "동료들과의 협력이 좋은 결과를 가져올 것입니다",
        "새로운 프로젝트에서 좋은 성과가 있을 것입니다",
      ],
      소길: [
        "무난한 하루가 될 것입니다",
        "평소대로 진행하면 좋은 결과가 있을 것입니다",
      ],
      평범: [
        "특별한 일 없이 일상적인 하루가 될 것입니다",
        "묵묵히 자신의 일에 집중하는 것이 좋습니다",
      ],
      흉: [
        "의사소통에 오해가 생길 수 있으니 주의하세요",
        "중요한 결정은 미루는 것이 좋습니다",
      ],
      대흉: [
        "중요한 실수가 있을 수 있으니 모든 것을 재확인하세요",
        "새로운 시도는 피하는 것이 좋습니다",
      ],
      존망: [
        "심각한 재앙이 업무에 닥칠 것입니다",
        "오늘 하는 모든 일은 실패할 운명입니다",
      ],
    },
    money: {
      태초: [
        "돈의 개념을 초월한 부를 얻게 될 것입니다",
        "황금비가 내리는 날입니다",
      ],
      대길: [
        "예상치 못한 수입이 생길 수 있습니다",
        "투자한 것에서 큰 수익이 있을 것입니다",
      ],
      중길: [
        "재물운이 좋으니 적극적으로 움직여보세요",
        "새로운 재테크를 시작하기 좋은 날입니다",
      ],
      소길: [
        "금전적으로 무난한 하루가 될 것입니다",
        "계획했던 지출이 예상대로 진행될 것입니다",
      ],
      평범: [
        "큰 지출이나 수입 없이 평범한 하루가 될 것입니다",
        "현재의 재정 상태를 유지하는 것이 좋습니다",
      ],
      흉: [
        "예상치 못한 지출이 있을 수 있습니다",
        "금전 거래는 신중하게 결정하세요",
      ],
      대흉: [
        "큰 금전적 손실이 있을 수 있으니 모든 거래를 조심하세요",
        "투자나 재테크는 절대 피하세요",
      ],
      존망: ["파산의 기운이 감돌고 있습니다", "지갑에 구멍이 뚫릴 것입니다"],
    },
  },
};

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

// 슬래시 커맨드 정의
const commands = [
  new SlashCommandBuilder()
    .setName("피파")
    .setDescription("피파 온라인 사용자 정보를 조회합니다")
    .addStringOption((option) =>
      option
        .setName("닉네임")
        .setDescription("조회할 사용자 닉네임을 입력하세요")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("tft아이템")
    .setDescription("TFT 챔피언의 최적 아이템을 조회합니다")
    .addStringOption((option) =>
      option
        .setName("챔피언")
        .setDescription(
          "아이템을 알고 싶은 챔피언의 이름을 입력하세요 (예: 하이머딩거, 베인)",
        )
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("맛집추천")
    .setDescription("주변 맛집을 추천해드립니다")
    .addStringOption((option) =>
      option
        .setName("지역")
        .setDescription("검색할 지역을 입력하세요 (예: 강남역, 홍대입구역)")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("게임모집")
    .setDescription("게임 참가자를 모집합니다")
    .addStringOption((option) =>
      option
        .setName("게임")
        .setDescription("게임 이름을 입력하세요")
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("인원")
        .setDescription("모집 인원을 입력하세요(2~10)")
        .setRequired(true)
        .setMinValue(2)
        .setMaxValue(10),
    )
    .addStringOption((option) =>
      option
        .setName("설명")
        .setDescription("게임 설명이나 하고 싶은 말을 입력하세요")
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("시")
        .setDescription("예약할 시간을 입력하세요 (24시간)")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(23),
    )
    .addIntegerOption((option) =>
      option
        .setName("분")
        .setDescription("예약할 분을 입력하세요")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(59),
    )
    .addBooleanOption((option) =>
      option
        .setName("전체알림")
        .setDescription("@everyone으로 전체 알림을 보낼지 선택하세요")
        .setRequired(true),
    ),
  // GGCK어 사전
  new SlashCommandBuilder()
    .setName("ggck어사전")
    .setDescription("GGCK어 사전을 검색하거나 목록을 확인합니다")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("검색")
        .setDescription("단어를 검색합니다")
        .addStringOption((option) =>
          option
            .setName("단어")
            .setDescription("검색할 단어를 입력하세요")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("목록")
        .setDescription("전체 GGCK어 목록을 확인합니다"),
    ),
  new SlashCommandBuilder()
    .setName("ggck어등록")
    .setDescription("새로운 GGCK어를 등록합니다 (관리자 전용)")
    .addStringOption((option) =>
      option.setName("단어").setDescription("등록할 단어").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("의미").setDescription("단어의 의미").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("예문").setDescription("단어 사용 예문").setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("분류")
        .setDescription("단어의 분류")
        .setRequired(true)
        .addChoices(
          { name: "강찬어", value: "강찬어" },
          { name: "신조어", value: "신조어" },
          { name: "감탄사", value: "감탄사" },
          { name: "기타", value: "기타" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("창시자")
        .setDescription("의미 만든 사람")
        .setRequired(true),
    ),
  // 날씨 커맨드
  new SlashCommandBuilder()
    .setName("날씨")
    .setDescription("지역의 현재 날씨를 확인합니다")
    .addStringOption((option) =>
      option
        .setName("지역")
        .setDescription("날씨를 확인할 지역을 입력하세요")
        .setRequired(true),
    ),
  // 운세 커맨드 추가
  new SlashCommandBuilder()
    .setName("운세")
    .setDescription("오늘의 운세를 확인합니다"),
];

// 게임 데이터와 타이머를 함께 관리
const gameParticipants = new Map();
const gameTimers = new Map();
const MAX_TIMEOUT = 2147483647; // 최대 setTimeout 지연시간 (약 24.8일)

// 게임 데이터 정리 함수
function cleanupGame(messageId) {
  const existingTimer = gameTimers.get(messageId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    gameTimers.delete(messageId);
  }
  gameParticipants.delete(messageId);
}

// 긴 지연시간을 처리하기 위한 체이닝 타이머 함수
function setLongTimeout(callback, delay) {
  if (delay > MAX_TIMEOUT) {
    return setTimeout(() => {
      setLongTimeout(callback, delay - MAX_TIMEOUT);
    }, MAX_TIMEOUT);
  } else {
    return setTimeout(callback, delay);
  }
}

// 풍향 변환 함수
function getWindDirection(degrees) {
  const directions = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

// 날씨 정보 조회 함수
async function getWeather(location) {
  try {
    // 지역 -> 좌표 변환
    const geocodingUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${process.env.OPENWEATHER_API_KEY}`;
    const geoResponse = await axios.get(geocodingUrl);

    if (!geoResponse.data.length) {
      throw new Error("지역을 찾을 수 없습니다.");
    }

    const { lat, lon } = geoResponse.data[0];

    // 날씨 정보 조회
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric&lang=kr`;
    const weatherResponse = await axios.get(weatherUrl);
    const data = weatherResponse.data;

    // 대기질 정보 조회
    const airUrl = `http://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${process.env.OPENWEATHER_API_KEY}`;
    const airResponse = await axios.get(airUrl);
    const airData = airResponse.data;

    // 대기질 지수 해석
    const aqiLabels = ["없음", "좋음", "보통", "나쁨", "매우 나쁨", "위험"];
    const aqi = aqiLabels[airData.list[0].main.aqi];

    return new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle(
        `${location}의 현재 날씨 ${weatherIcons[data.weather[0].icon] || "🌈"}`,
      )
      .setDescription(data.weather[0].description)
      .addFields(
        {
          name: "기온",
          value: `${Math.round(data.main.temp)}°C (체감 ${Math.round(data.main.feels_like)}°C)`,
          inline: true,
        },
        {
          name: "습도",
          value: `${data.main.humidity}%`,
          inline: true,
        },
        {
          name: "기압",
          value: `${data.main.pressure}hPa`,
          inline: true,
        },
        {
          name: "풍속/풍향",
          value: `${data.wind.speed}m/s / ${getWindDirection(data.wind.deg)}`,
          inline: true,
        },
        {
          name: "최고/최저 기온",
          value: `${Math.round(data.main.temp_max)}°C / ${Math.round(data.main.temp_min)}°C`,
          inline: true,
        },
        {
          name: "대기질",
          value: aqi,
          inline: true,
        },
      )
      .setFooter({ text: "데이터 제공: OpenWeather" })
      .setTimestamp();
  } catch (error) {
    console.error("날씨 정보 조회 중 에러:", error);
    throw error;
  }
}

// 네이버 지도 API 호출 함수
async function searchRestaurants(location) {
  try {
    // 검색어에 '맛집' 키워드 추가
    const query = encodeURIComponent(`${location} 맛집`);
    const url = `https://openapi.naver.com/v1/search/local.json?query=${query}&display=15&sort=random`;

    const response = await axios.get(url, {
      headers: {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
      },
    });

    return response.data.items;
  } catch (error) {
    console.error("네이버 API 호출 중 에러:", error);
    throw error;
  }
}

// 맛집 추천 임베드 생성 함수
function createRestaurantEmbed(restaurant, location) {
  const embed = new EmbedBuilder()
    .setColor("#03C75A") // 네이버 색상
    .setTitle(`🍽️ ${restaurant.title.replace(/<[^>]*>/g, "")}`)
    .setDescription(`${location} 주변 맛집을 추천해드립니다!`)
    .addFields(
      { name: "📍 주소", value: restaurant.address },
      { name: "📞 연락처", value: restaurant.telephone || "번호 없음" },
      { name: "🔍 카테고리", value: restaurant.category || "정보 없음" },
      { name: "🌐 상세정보", value: restaurant.link || "정보 없음" },
    )
    .setFooter({ text: "데이터 제공: 네이버 지도" })
    .setTimestamp();

  return embed;
}

// puuid 조회
async function getPuuid(summonerId) {
  try {
    const data = await makeRiotRequest(
      `https://kr.api.riotgames.com/tft/summoner/v1/summoners/${summonerId}`,
    );
    return data.puuid;
  } catch (error) {
    console.error(`getPuuid 에러 (summonerId: ${summonerId}):`, error.message);
    throw error;
  }
}

// 최근 매치 목록 조회
async function getRecentMatches(puuid) {
  try {
    const data = await makeRiotRequest(
      `${MATCH_API_BASE}/matches/by-puuid/${puuid}/ids?count=3`,
    );
    return data;
  } catch (error) {
    console.error(
      `getRecentMatches 에러 (puuid: ${puuid.substring(0, 8)}...):`,
      error.message,
    );
    throw error;
  }
}

// 매치 상세 정보 조회
async function getMatchDetails(matchId) {
  try {
    const data = await makeRiotRequest(`${MATCH_API_BASE}/matches/${matchId}`);
    return data;
  } catch (error) {
    console.error(`getMatchDetails 에러 (matchId: ${matchId}):`, error.message);
    throw error;
  }
}

// 챔피언별 아이템 통계 수집 함수
async function collectChampionItemStats(specificChampions = null) {
  try {
    // 캐시 체크는 기존과 동일
    if (specificChampions?.length === 1) {
      const champion = specificChampions[0];
      const cachedStats = statsCache.get(champion);
      if (cachedStats && Date.now() - cachedStats.timestamp < CACHE_DURATION) {
        return cachedStats.data;
      }
    }

    // 순차적으로 처리
    console.log("챌린저 티어 데이터 수집 중...");
    const challengerPlayers = await makeRiotRequest(
      `${LEAGUE_API_BASE}/challenger`,
    );

    console.log("그랜드마스터 티어 데이터 수집 중...");
    const grandmasterPlayers = await makeRiotRequest(
      `${LEAGUE_API_BASE}/grandmaster`,
    );

    // 두 티어의 플레이어를 합침
    const highTierPlayers = [
      ...challengerPlayers.entries,
      ...grandmasterPlayers.entries,
    ];

    // 배치 사이즈를 더 작게 조정하여 요청 부하 감소
    const BATCH_SIZE = 3;
    const matchStats = new Map();

    // 플레이어 수 제한 (더 적은 수로 제한)
    const maxPlayers = 30;

    console.log(`최대 ${maxPlayers}명의 플레이어 데이터를 처리합니다...`);

    // 플레이어 순차 처리 (완전 병렬이 아닌 배치별 순차 처리)
    for (
      let i = 0;
      i < Math.min(highTierPlayers.length, maxPlayers);
      i += BATCH_SIZE
    ) {
      const batch = highTierPlayers.slice(i, i + BATCH_SIZE);
      console.log(
        `플레이어 배치 처리 중: ${i + 1}~${Math.min(i + BATCH_SIZE, maxPlayers)}/${maxPlayers}`,
      );

      // 각 배치 내에서는 병렬 처리
      await Promise.all(
        batch.map(async (player) => {
          try {
            const puuid = await getPuuid(player.summonerId);

            // 매치 수를 제한 (5에서 3으로 줄임)
            const matches = await getRecentMatches(puuid);
            const limitedMatches = matches.slice(0, 3);

            console.log(
              `플레이어 ${player.summonerName || player.summonerId}의 ${limitedMatches.length}개 매치 처리 중...`,
            );

            // 매치 순차 처리 (병렬 대신)
            for (const matchId of limitedMatches) {
              try {
                const matchData = await getMatchDetails(matchId);
                processMatchData(matchData, matchStats, specificChampions);

                // 매치 요청 사이에 딜레이 추가
                await new Promise((resolve) => setTimeout(resolve, 100));
              } catch (error) {
                console.error(`Error processing match ${matchId}:`, error);
              }
            }
          } catch (error) {
            console.error(
              `Error processing player ${player.summonerId}:`,
              error,
            );
          }
        }),
      );

      // 배치 처리 사이에 딜레이 추가
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 결과 처리 및 캐싱 (기존과 동일)
    const results = new Map();
    for (const [champion, stats] of matchStats.entries()) {
      const processedStats = processItemCombinations(stats.itemCombinations);
      results.set(champion, processedStats);

      // 캐시 업데이트
      statsCache.set(champion, {
        data: processedStats,
        timestamp: Date.now(),
      });

      // Firebase 업데이트
      await tftStatsRef.doc(champion).set({
        items: processedStats,
        updatedAt: new Date(),
      });
    }

    return results;
  } catch (error) {
    console.error("Error in collectChampionItemStats:", error);
    throw error;
  }
}

// 매치 데이터 처리
function processMatchData(matchData, matchStats, specificChampions = null) {
  // 1등만 필터링 (placement가 1인 참가자)
  const winners = matchData.info.participants.filter((p) => p.placement === 1);

  for (const participant of winners) {
    for (const unit of participant.units) {
      if (specificChampions && !specificChampions.includes(unit.character_id)) {
        continue;
      }

      if (!matchStats.has(unit.character_id)) {
        matchStats.set(unit.character_id, {
          itemCombinations: new Map(),
        });
      }

      const champStats = matchStats.get(unit.character_id);

      // 아이템 조합 분석 - 3개 아이템 세트로 분석
      const items = [...unit.items].sort(); // 정렬하여 동일한 조합이 항상 같은 키를 가지도록 함

      // 조합 키 생성
      if (items.length > 0) {
        // 아이템이 3개 미만인 경우에도 처리
        const combinationKey = items.join(",");

        if (!champStats.itemCombinations.has(combinationKey)) {
          champStats.itemCombinations.set(combinationKey, 0);
        }

        champStats.itemCombinations.set(
          combinationKey,
          champStats.itemCombinations.get(combinationKey) + 1,
        );
      }
    }
  }
}

// 아이템 조합 통계 처리 함수
function processItemCombinations(combinationsMap) {
  const totalCombinations = Array.from(combinationsMap.values()).reduce(
    (a, b) => a + b,
    0,
  );

  if (totalCombinations === 0) {
    return [];
  }

  return Array.from(combinationsMap.entries())
    .sort((a, b) => b[1] - a[1]) // 빈도순 정렬
    .slice(0, 10) // 상위 10개 조합 선택
    .map(([comboKey, count]) => {
      const itemIds = comboKey.split(",").map((id) => parseInt(id));
      return {
        itemIds,
        count,
        frequency: ((count / totalCombinations) * 100).toFixed(1),
        itemNames: itemIds.map((id) => itemMapping[id] || `아이템 ${id}`),
      };
    })
    .slice(0, 3); // 최종적으로 상위 3개만 선택
}

// 추천 아이템 조회 함수 개선
async function getRecommendedItems(championName) {
  try {
    const champion = championMapping[championName];
    if (!champion) {
      throw new Error("Champion not found");
    }

    let stats = await tftStatsRef.doc(champion).get();

    if (
      !stats.exists ||
      Date.now() - stats.data().updatedAt.toDate() > CACHE_DURATION
    ) {
      // 데이터가 없거나 오래된 경우 새로 수집
      const newStats = await collectChampionItemStats([champion]);
      stats = newStats.get(champion);
    } else {
      stats = stats.data().items;
    }

    return {
      champion: championName,
      items: stats.map((item) => ({
        combination: item.itemNames,
        frequency: item.frequency,
      })),
    };
  } catch (error) {
    console.error(
      `Error getting recommended items for ${championName}:`,
      error,
    );
    throw error;
  }
}

// TFT 아이템 조회 명령어 핸들러
async function handleTftItemsCommand(interaction) {
  try {
    await interaction.deferReply();

    const userInput = interaction.options.getString("챔피언");
    const champion = championMapping[userInput];

    if (!champion) {
      const availableChampions = Object.keys(championMapping);
      const similarChampions = availableChampions
        .filter((name) => name.includes(userInput) || userInput.includes(name))
        .slice(0, 3);

      let errorMessage = `'${userInput}'은(는) 등록되지 않은 챔피언 이름입니다.\n`;
      if (similarChampions.length > 0) {
        errorMessage += `혹시 이 챔피언을 찾으시나요? ${similarChampions.join(", ")}`;
      } else {
        errorMessage += `챔피언 이름을 정확히 입력해주세요.`;
      }

      await interaction.editReply(errorMessage);
      return;
    }

    let statsDoc = await tftStatsRef.doc(champion).get();

    if (!statsDoc.exists) {
      await interaction.editReply(
        `${userInput}의 통계 데이터를 수집 중입니다. 잠시만 기다려주세요...`,
      );
      try {
        await collectChampionItemStats([champion]);
        statsDoc = await tftStatsRef.doc(champion).get();
      } catch (error) {
        console.error("TFT 통계 수집 중 에러:", error);
        if (error.response?.status === 403) {
          await interaction.editReply(
            "Riot API 키가 만료되었습니다. 관리자에게 문의해주세요.",
          );
        } else if (error.response?.status === 429) {
          await interaction.editReply(
            "너무 많은 요청이 있었습니다. 잠시 후 다시 시도해주세요.",
          );
        } else {
          await interaction.editReply(
            `${userInput}의 통계 데이터 수집 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.`,
          );
        }
        return;
      }
    }

    if (!statsDoc.exists) {
      await interaction.editReply(
        `${userInput}의 통계 데이터 수집에 실패했습니다. 잠시 후 다시 시도해주세요.`,
      );
      return;
    }

    const stats = statsDoc.data();
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle(`${userInput} 추천 아이템 조합`)
      .setDescription("그랜드마스터 이상 1등 플레이 데이터 기반")
      .addFields(
        stats.items.map((item, index) => ({
          name: `${index + 1}순위 아이템 조합`,
          value: `${item.itemNames.join(" + ")}\n채택률: ${item.frequency}%`,
          inline: true,
        })),
      )
      .setFooter({ text: "6시간마다 업데이트됩니다." })
      .setTimestamp(stats.updatedAt.toDate());

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("TFT 아이템 조회 중 에러:", error);
    await interaction.editReply(
      "아이템 정보를 조회하는 중 오류가 발생했습니다.",
    );
  }
}

// 3. 피파 온라인 정보 조회 핸들러 함수
async function handleFifaCommand(interaction) {
  try {
    await interaction.deferReply();

    const nickname = interaction.options.getString("닉네임");
    console.log(`닉네임 "${nickname}"에 대한 정보 조회 시작...`);

    // OUID 조회 (이제 직접 ouid 문자열 반환)
    const ouid = await getFifaOUID(nickname);
    console.log(`OUID 조회 결과: ${ouid} (타입: ${typeof ouid})`);

    if (!ouid) {
      return await interaction.editReply(
        `'${nickname}' 사용자를 찾을 수 없습니다.`,
      );
    }

    // 기본 정보 조회
    const userInfo = await getFifaUserInfo(ouid);
    console.log("사용자 기본 정보:", JSON.stringify(userInfo));

    // 최고 등급 정보 조회
    const maxDivisions = await getFifaMaxDivision(ouid);
    console.log("최고 등급 정보:", JSON.stringify(maxDivisions));

    // Embed 생성
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle(`🎮 ${userInfo.nickname || nickname}님의 피파 온라인 정보`)
      .setDescription(`레벨: ${userInfo.level || "정보 없음"}`)
      .setThumbnail(
        "https://ssl.nexon.com/s2/game/fo4/shop/playerkits/230/p230147.png",
      )
      .setFooter({ text: "데이터 제공: NEXON OPEN API" })
      .setTimestamp();

    // 최고 등급 정보 추가
    if (maxDivisions && maxDivisions.length > 0) {
      maxDivisions.forEach((division) => {
        try {
          const matchName = getMatchTypeName(division.matchType);
          const divisionName = getDivisionName(division.division);

          // 달성일 포매팅
          let formattedDate = "정보 없음";
          if (division.achievementDate) {
            const achievementDate = new Date(division.achievementDate);
            formattedDate = new Intl.DateTimeFormat("ko-KR", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(achievementDate);
          }

          embed.addFields({
            name: `${matchName} 최고 등급`,
            value: `${divisionName} (달성일: ${formattedDate})`,
            inline: true,
          });
        } catch (err) {
          console.error("등급 정보 처리 중 오류:", err);
          embed.addFields({
            name: "등급 정보 오류",
            value: "등급 정보를 처리하는 중 오류가 발생했습니다.",
            inline: true,
          });
        }
      });
    } else {
      embed.addFields({
        name: "최고 등급 정보",
        value: "등급 정보가 없습니다",
        inline: true,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("피파 정보 조회 중 에러:", error);

    let errorMessage = "정보를 조회하는 중 오류가 발생했습니다.";
    if (error.response) {
      if (error.response.status === 404) {
        errorMessage = "존재하지 않는 사용자입니다.";
      } else if (error.response.status === 429) {
        errorMessage =
          "너무 많은 요청이 있었습니다. 잠시 후 다시 시도해주세요.";
      } else if (
        error.response.status === 401 ||
        error.response.status === 403
      ) {
        errorMessage = "API 키가 유효하지 않습니다. 관리자에게 문의하세요.";
      } else if (error.response.status === 400) {
        errorMessage = "잘못된 요청입니다. 닉네임을 정확히 입력해주세요.";
        if (error.response.data) {
          errorMessage += `\n상세 오류: ${JSON.stringify(error.response.data)}`;
        }
      }
    }

    await interaction.editReply(`⚠️ ${errorMessage}`);
  }
}

// 운세 생성 함수
function generateFortune(userId) {
  // 기존 한국 시간 가져오기 사용
  // 매번 새롭게 날짜 계산
  const koreanNow = getCurrentKoreanDate();
  const today = koreanNow.toISOString().slice(0, 10).replace(/-/g, "");

  console.log("오늘 날짜 (재계산됨):", today);

  // 더 복잡한 시드 생성
  let seed = 0;
  const input = userId.toString() + today;
  for (let i = 0; i < input.length; i++) {
    seed = (seed << 5) - seed + input.charCodeAt(i);
    seed = seed >>> 0; // 부호 없는 32비트 정수로 변환
  }

  // 시드 생성 과정 로깅
  console.log(
    "운세 생성 정보:",
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(koreanNow),
    "\n입력값:",
    input,
    "\n사용자 ID:",
    userId,
    "\n시드번호:",
    seed,
    "\n원본 날짜:",
    today,
  );

  const seedRandom = () => {
    // Mulberry32 알고리즘
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = Math.imul(t + (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const random = seedRandom() * 100;
  let accumulated = 0;
  let selectedGrade;

  for (const grade of fortuneData.grades) {
    accumulated += grade.probability;
    if (random <= accumulated) {
      selectedGrade = grade;
      break;
    }
  }

  // 운세 결과도 로깅
  console.log(
    "랜덤 값:",
    random,
    "\n선택된 등급:",
    selectedGrade.grade,
    "\n확률:",
    selectedGrade.probability,
    "%",
  );

  // 나머지 부분은 그대로 유지
  const getRandomMessage = (category, grade) => {
    const messages = fortuneData.categories[category][grade.grade];
    return messages[Math.floor(seedRandom() * messages.length)];
  };

  const avoidThis =
    fortuneData.advice.avoid[
      Math.floor(seedRandom() * fortuneData.advice.avoid.length)
    ];
  const doThis =
    fortuneData.advice.do[
      Math.floor(seedRandom() * fortuneData.advice.do.length)
    ];

  return {
    grade: selectedGrade,
    study: getRandomMessage("study", selectedGrade),
    work: getRandomMessage("work", selectedGrade),
    money: getRandomMessage("money", selectedGrade),
    avoidThis,
    doThis,
  };
}

// 운세 표시용 임베드 생성
function createFortuneEmbed(fortune, username) {
  return new EmbedBuilder()
    .setColor(fortune.grade.color)
    .setTitle(
      `${fortune.grade.emoji} ${username}님의 오늘의 운세: ${fortune.grade.grade}`,
    )
    .addFields(
      { name: "📚 학업/공부", value: fortune.study },
      { name: "💼 직장/일", value: fortune.work },
      { name: "💰 금전/재물", value: fortune.money },
      {
        name: "🎯 오늘의 조언",
        value: `『${fortune.avoidThis}』를 멀리하고 『${fortune.doThis}』를 가까이하세요.`,
      },
    )
    .setFooter({ text: "매일 00시에 운세가 갱신됩니다!" })
    .setTimestamp();
}

// 게임 알림 처리를 위한 개선된 함수
async function sendGameNotifications(client, gameData, messageId) {
  try {
    if (!gameData) {
      console.error("Game data not found for message ID:", messageId);
      return false;
    }

    const participantsList = gameData.participants.join(", ");
    const notifications = [];

    // 각 참가자에게 DM 전송
    for (const participantId of gameData.participantIds) {
      const notification = (async () => {
        try {
          const user = await client.users.fetch(participantId);
          await user.send({
            content: `🎮 ${gameData.game} 시작 시간이다!! (${formatTime(gameData.scheduledTime)})\n참가자: ${participantsList}\n스@근~하게 드러온나!`,
          });
          return { success: true, userId: participantId };
        } catch (error) {
          console.error(`Failed to send DM to ${participantId}:`, error);
          return { success: false, userId: participantId, error };
        }
      })();
      notifications.push(notification);
    }

    // 모든 DM 전송 결과 확인
    const results = await Promise.allSettled(notifications);
    const failedNotifications = results
      .filter((result) => result.status === "rejected" || !result.value.success)
      .map((result) => result.value?.userId)
      .filter(Boolean);

    if (failedNotifications.length > 0) {
      console.error(
        `Failed to send DMs to users: ${failedNotifications.join(", ")}`,
      );
    }

    return failedNotifications.length < gameData.participantIds.length; // 최소 1명에게는 전송 성공
  } catch (error) {
    console.error("Error in sendGameNotifications:", error);
    return false;
  }
}

// 게임 타이머 설정 함수 개선
function setGameTimer(client, messageId, gameData, scheduledTime) {
  const now = Date.now();
  const timeUntilScheduled = scheduledTime.getTime() - now;

  if (timeUntilScheduled <= 0) {
    console.error(
      `Invalid scheduled time for game ${messageId}: Time is in the past`,
    );
    cleanupGame(messageId);
    return;
  }

  const timer = setLongTimeout(async () => {
    try {
      const currentGameData = gameParticipants.get(messageId);
      if (!currentGameData) {
        console.error("Game data not found:", messageId);
        return;
      }

      try {
        const channel = await client.channels.fetch(currentGameData.channel);
        if (currentGameData.participants.length < currentGameData.maxPlayers) {
          // 인원이 부족한 경우
          await channel.send({
            content: "❌ 인원이 부족하여 게임이 취소되었습니다.",
          });

          // 취소 DM만 전송
          await Promise.all(
            currentGameData.participantIds.map(async (participantId) => {
              try {
                const user = await client.users.fetch(participantId);
                await user.send({
                  content: `❌ ${currentGameData.game} 게임이 인원 부족으로 취소되었습니다.`,
                });
              } catch (error) {
                console.error(
                  `Failed to send cancellation DM to ${participantId}:`,
                  error,
                );
              }
            }),
          );
        } else {
          // 게임 시작 알림
          const participantMentions = currentGameData.participantIds
            .map((id) => `<@${id}>`)
            .join(" ");

          await channel.send({
            content: `${currentGameData.game} 해야지 ${participantMentions} 자식들아!! 들어와라!!`,
            allowedMentions: { users: currentGameData.participantIds },
          });

          // 게임 시작 DM 전송
          const notificationSuccess = await sendGameNotifications(
            client,
            currentGameData,
            messageId,
          );

          if (!notificationSuccess) {
            await channel.send({
              content: "⚠️ 일부 참가자에게 DM 전송이 실패했습니다.",
            });
          }
        }
      } catch (error) {
        console.error("Failed to send channel notification:", error);
      }

      // 모든 처리가 끝난 후에 정리
      cleanupGame(messageId);
    } catch (error) {
      console.error("Error in game timer callback:", error);
      cleanupGame(messageId);
    }
  }, timeUntilScheduled);

  gameTimers.set(messageId, timer);
}

// 게임 생성 함수 수정
function createGame(client, interaction, gameData) {
  const messageId = Date.now().toString();

  // Firebase에 저장할 데이터 준비
  const gameDoc = {
    ...gameData,
    channel: interaction.channelId,
    scheduledTimestamp: getKoreanTimestamp(gameData.scheduledTime), // Timestamp로 변환
    createdAt: Timestamp.now(),
  };

  // Firestore에 게임 데이터 저장
  db.collection("games")
    .doc(messageId)
    .set(gameDoc)
    .catch((error) => console.error("Error saving game data:", error));

  gameParticipants.set(messageId, {
    ...gameDoc,
    endTime: gameData.scheduledTime.getTime(),
  });

  setGameTimer(client, messageId, gameDoc, gameData.scheduledTime);
  return messageId;
}

// 주기적으로 만료된 게임 정리 (1시간마다)
setInterval(
  () => {
    const now = Date.now();
    for (const [messageId, gameData] of gameParticipants.entries()) {
      if (now > gameData.endTime) {
        cleanupGame(messageId);
      }
    }
  },
  60 * 60 * 1000,
);

// 준비되면 실행
client.once("ready", async () => {
  try {
    console.log(`Logged in as ${client.user.tag}!`);

    // 봇이 참여한 모든 서버 순회
    client.guilds.cache.forEach(async (guild) => {
      // 서버 소유자를 관리자로 설정
      await setAdmin(guild.ownerId, guild.id);
    });

    // 슬래시 커맨드 등록
    const rest = new REST({ version: "10" }).setToken(
      process.env.DISCORD_TOKEN,
    );
    try {
      await rest.put(Routes.applicationCommands(client.user.id), {
        body: commands,
      });
      console.log("슬래시 커맨드가 등록되었습니다!");
    } catch (error) {
      console.error("슬래시 커맨드 등록 중 에러:", error);
    }
  } catch (error) {
    console.error("봇 초기화 중 에러:", error);
  }
});

// 새로운 서버에 봇이 초대되었을 때
client.on("guildCreate", async (guild) => {
  try {
    // 새 서버의 소유자를 관리자로 설정
    await setAdmin(guild.ownerId, guild.id);
  } catch (error) {
    console.error("새 서버 관리자 설정 중 에러:", error);
  }
});

// 인터랙션 처리
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isCommand() && !interaction.isButton()) return;

    // 슬래시 커맨드 처리
    if (interaction.isCommand()) {
      if (interaction.commandName === "피파") {
        await handleFifaCommand(interaction);
      }
      if (interaction.commandName === "tft아이템") {
        await handleTftItemsCommand(interaction);
      }
      if (interaction.commandName === "맛집추천") {
        try {
          await interaction.deferReply();

          const location = interaction.options.getString("지역");
          const restaurants = await searchRestaurants(location);

          if (!restaurants || restaurants.length === 0) {
            await interaction.editReply(
              "해당 지역의 맛집 정보를 찾을 수 없습니다.",
            );
            return;
          }

          // 랜덤하게 하나의 맛집 선택
          const restaurant =
            restaurants[Math.floor(Math.random() * restaurants.length)];
          const embed = createRestaurantEmbed(restaurant, location);

          // 새로운 추천 받기 버튼 생성
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`reroll_restaurant_${location}`)
              .setLabel("다른 맛집 추천받기")
              .setStyle(ButtonStyle.Primary)
              .setEmoji("🎲"),
          );

          await interaction.editReply({
            embeds: [embed],
            components: [row],
          });
        } catch (error) {
          console.error("맛집 검색 중 에러:", error);
          await interaction.editReply("맛집 검색 중 오류가 발생했습니다.");
        }
      }
      if (interaction.commandName === "운세") {
        const fortune = generateFortune(interaction.user.id);
        const embed = createFortuneEmbed(
          fortune,
          interaction.member.displayName,
        );

        let content = null;
        let specialEffects = [];

        if (fortune.grade.grade === "태초") {
          // 태초 등급 전용 특수 효과
          content = `@everyone\n
🌟 경 이 로 운 · 순 간 🌟
⠀
✨✨✨  태 초 등 급  ✨✨✨
⠀
${interaction.member.displayName}님께서 0.2%의 확률을 뚫고
태초 등급을 획득하셨습니다!
⠀
축하의 의미로 태초의 빛이 내립니다...`;

          // 특수 효과 메시지들
          specialEffects = [
            "```diff\n+ 우주가 진동하기 시작합니다...```",
            "```fix\n☆ 태초의 기운이 흐릅니다... ☆```",
            "```yaml\n시공간이 뒤틀리기 시작합니다...```",
            "```css\n[ 태초의 문이 열립니다... ]```",
            `${interaction.member.displayName}님의 운명이 재정의됩니다...`,
          ];

          // 임베드 색상을 무지개 효과로
          embed.setColor(
            "#" + Math.floor(Math.random() * 16777215).toString(16),
          );
        } else if (fortune.grade.grade === "대흉") {
          content = "오늘은 하루종일 집에서 쉬는건 어떨까요...";
        } else if (fortune.grade.grade === "대길") {
          content = `@everyone\n🎊 ${interaction.member.displayName}님께서 대길을 받으셨습니다!! 모두 축하해주세요!! 🎉`;

          // 추가 축하 메시지 채널에 보내기
          try {
            await interaction.channel.send({
              content: `축하합니다! ${interaction.member.displayName}님의 오늘 운세는 ${fortune.grade.emoji} 대길 입니다!!\n행운이 가득한 하루 되세요! 🍀`,
              allowedMentions: { parse: [] },
            });
          } catch (error) {
            console.error("축하 메시지 전송 실패:", error);
          }
        } else if (fortune.grade.grade === "존망") {
          // 존망 등급 전용 특수 효과
          content = `@everyone\n
☠️ 비 극 적 인 · 순 간 ☠️
⠀
💀💀💀  존 망 등 급  💀💀💀
⠀
${interaction.member.displayName}님께서 0.2%의 확률로
존망 등급의 저주를 받으셨습니다!
⠀
불운의 징조로 존망의 그림자가 드리웁니다...`;

          // 특수 효과 메시지들
          specialEffects = [
            "```diff\n- 심연이 울부짖기 시작합니다...```",
            "```fix\n☠ 존망의 기운이 스며듭니다... ☠```",
            "```yaml\n운명의 실이 끊어지기 시작합니다...```",
            "```css\n[ 불멸의 문이 닫힙니다... ]```",
            `${interaction.member.displayName}님의 운명이 뒤틀립니다...`,
          ];

          // 임베드 색상을 어두운 색으로
          embed.setColor("#000000"); // 검은색
        }

        // 먼저 운세 결과 전송
        await interaction.reply({
          content,
          embeds: [embed],
          allowedMentions: { parse: ["everyone"] },
        });

        // 태초 등급일 경우 특수 효과 순차 전송
        if (fortune.grade.grade === "태초") {
          for (const effect of specialEffects) {
            await new Promise((resolve) => setTimeout(resolve, 1500)); // 1.5초 간격
            await interaction.channel.send(effect);
          }

          // 마지막 대형 효과
          await new Promise((resolve) => setTimeout(resolve, 2000));
          // 태초 메시지를 여러 가지 코드 블록 스타일로 표현
          await interaction.channel.send(`\`\`\`fix
⭐️ ⋆ ˚｡⋆୨୧˚ 태 초 의 축 복 ˚୨୧⋆｡˚ ⋆ ⭐️
\`\`\``);

          await new Promise((resolve) => setTimeout(resolve, 800));

          await interaction.channel.send(`\`\`\`diff
+ ₊⊹⭒══════════════════════════⭒⊹₊
+    신들의 축복이 내립니다...
+ ₊⊹⭒══════════════════════════⭒⊹₊
\`\`\``);

          await new Promise((resolve) => setTimeout(resolve, 800));

          await interaction.channel.send(`\`\`\`yaml
이 상서로운 기운은 천년에 한번 올까말까한 기회입니다!
\`\`\``);

          await new Promise((resolve) => setTimeout(resolve, 800));

          await interaction.channel.send(`\`\`\`css
[당신의 오늘은 전설이 될 것입니다...]
\`\`\``);

          await new Promise((resolve) => setTimeout(resolve, 800));

          await interaction.channel.send(`\`\`\`css
[행복한 하루 되세요!]
\`\`\``);
        }

        // 존망 등급일 경우 특수 효과 순차 전송
        if (fortune.grade.grade === "존망") {
          for (const effect of specialEffects) {
            await new Promise((resolve) => setTimeout(resolve, 1500)); // 1.5초 간격
            await interaction.channel.send(effect);
          }

          // 마지막 대형 효과
          await new Promise((resolve) => setTimeout(resolve, 2000));
          // 존망 메시지를 여러 가지 코드 블록 스타일로 표현
          await interaction.channel.send(`\`\`\`fix
☠️ ⋆ ˚｡⋆୨୧˚ 존 망 의 저 주 ˚୨୧⋆｡˚ ⋆ ☠️
\`\`\``);

          await new Promise((resolve) => setTimeout(resolve, 800));

          await interaction.channel.send(`\`\`\`diff
- ₊⊹⭒══════════════════════════⭒⊹₊
-    심연의 저주가 깃듭니다...
- ₊⊹⭒══════════════════════════⭒⊹₊
\`\`\``);

          await new Promise((resolve) => setTimeout(resolve, 800));

          await interaction.channel.send(`\`\`\`yaml
이 불길한 조짐은 천년에 한번 올까말까한 파멸의 징조입니다!
\`\`\``);

          await new Promise((resolve) => setTimeout(resolve, 800));

          await interaction.channel.send(`\`\`\`css
[당신의 오늘은 역사에 기록될 불운으로 남을 것입니다...]
\`\`\``);

          await new Promise((resolve) => setTimeout(resolve, 800));

          await interaction.channel.send(`\`\`\`css
[모든 선택에 신중하세요... 운명이 당신을 주시합니다...]
\`\`\``);
        }
      }
      // 날씨 커맨드 핸들러
      if (interaction.commandName === "날씨") {
        try {
          await interaction.deferReply(); // 응답 지연 표시

          const location = interaction.options.getString("지역");
          const weatherEmbed = await getWeather(location);

          await interaction.editReply({ embeds: [weatherEmbed] });
        } catch (error) {
          let errorMessage = "날씨 정보를 가져오는 중 오류가 발생했습니다.";
          if (error.message === "지역을 찾을 수 없습니다.") {
            errorMessage =
              "입력하신 지역을 찾을 수 없습니다. 지역명을 다시 확인해주세요.";
          }

          await interaction.editReply({
            content: errorMessage,
            ephemeral: true,
          });
        }
      }
      if (interaction.commandName === "게임모집") {
        const game = interaction.options.getString("게임");
        const players = interaction.options.getInteger("인원");
        const description = interaction.options.getString("설명");
        const hour = interaction.options.getInteger("시");
        const minute = interaction.options.getInteger("분");
        const useEveryone = interaction.options.getBoolean("전체알림") ?? false;

        // createScheduledTime 함수를 사용하여 예약 시간 설정
        const scheduledDate = createScheduledTime(hour, minute);

        // 디버깅을 위한 시간 정보 로깅
        logTimeInfo(scheduledDate);

        const messageId = createGame(client, interaction, {
          host: interaction.member.displayName,
          hostId: interaction.member.id,
          participants: [interaction.member.displayName],
          participantIds: [interaction.member.id],
          maxPlayers: players,
          scheduledTime: scheduledDate,
          game: game,
          useEveryone: useEveryone,
        });

        const embed = new EmbedBuilder()
          .setColor("#0099ff")
          .setTitle(`🎮 ${game} 모집 중!`)
          .addFields(
            {
              name: "모집자",
              value: interaction.member.displayName,
              inline: true,
            },
            { name: "모집 인원", value: `${players}명`, inline: true },
            { name: "현재 인원", value: "1명", inline: true },
            {
              name: "예약 시간",
              value: formatTime(scheduledDate),
              inline: true,
            },
            { name: "설명", value: description },
          )
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`join_${messageId}`)
            .setLabel("참가하기")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`leave_${messageId}`)
            .setLabel("도망가기")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`cancel_${messageId}`)
            .setLabel("모집 취소하기")
            .setStyle(ButtonStyle.Danger),
        );

        const reply = await interaction.reply({
          content: useEveryone ? "@everyone 인원 모집이다!!" : null,
          embeds: [embed],
          components: [row],
          fetchReply: true,
          allowedMentions: { parse: ["everyone"] },
        });
      }

      // GGCK어 등록
      if (interaction.commandName === "ggck어등록") {
        // 관리자 권한 체크
        if (!(await isAdmin(interaction.user.id, interaction.guildId))) {
          await interaction.reply({
            content: "GGCK어는 서버 주인만 등록할 수 있다 쓰바라마!",
            ephemeral: true,
          });
          return;
        }

        const word = interaction.options.getString("단어");
        const meaning = interaction.options.getString("의미");
        const example = interaction.options.getString("예문");
        const creator = interaction.options.getString("창시자");
        const category = interaction.options.getString("분류");

        try {
          // 기존 단어 검색
          const wordDoc = await ggckWordsRef.doc(word).get();

          if (wordDoc.exists) {
            const confirmRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`confirm_update_${word}`)
                .setLabel("업데이트")
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`cancel_update_${word}`)
                .setLabel("취소")
                .setStyle(ButtonStyle.Secondary),
            );

            await interaction.reply({
              content: "이미 존재하는 단어다! 업데이트 할까?",
              components: [confirmRow],
              ephemeral: true,
            });
            return;
          }

          // 새 단어 추가
          await ggckWordsRef.doc(word).set({
            word,
            meaning,
            example,
            category,
            creator: creator,
            addedBy: interaction.user.tag,
            addedAt: new Date(),
            isActive: true,
          });

          const embed = new EmbedBuilder()
            .setColor("#00ff00")
            .setTitle("✅ GGCK어 등록 완료!")
            .addFields(
              { name: "단어", value: word },
              { name: "의미", value: meaning },
              { name: "예문", value: example },
              { name: "창시자", value: creator },
              { name: "분류", value: category },
            );

          await interaction.reply({ embeds: [embed] });
        } catch (error) {
          console.error("GGCK어 등록 중 에러 발생:", error);
          await interaction.reply({
            content: "등록 중 에러가 발생했다 쓰바라마!",
            ephemeral: true,
          });
        }
      }

      // GGCK어 검색
      if (interaction.commandName === "ggck어사전") {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "검색") {
          const searchWord = interaction.options.getString("단어");

          try {
            const wordDoc = await ggckWordsRef.doc(searchWord).get();

            if (!wordDoc.exists || !wordDoc.data().isActive) {
              await interaction.reply({
                content: "그런 단어는 없다 쓰바라마!",
                ephemeral: true,
              });
              return;
            }

            const wordData = wordDoc.data();
            const embed = new EmbedBuilder()
              .setColor("#0099ff")
              .setTitle(`📚 ${searchWord}`)
              .addFields(
                { name: "의미", value: wordData.meaning },
                { name: "예문", value: wordData.example },
                { name: "창시자", value: wordData.creator },
                { name: "분류", value: wordData.category },
              )
              .setFooter({ text: "GGCK어 사전 Ver 1.0" });

            await interaction.reply({ embeds: [embed] });
          } catch (error) {
            console.error("GGCK어 검색 중 에러 발생:", error);
            await interaction.reply({
              content: "검색 중 에러가 발생했다 쓰바라마!",
              ephemeral: true,
            });
          }
        } else if (subcommand === "목록") {
          try {
            const snapshot = await ggckWordsRef
              .where("isActive", "==", true)
              .get();
            const categories = {};

            snapshot.forEach((doc) => {
              const wordData = doc.data();
              if (!categories[wordData.category]) {
                categories[wordData.category] = [];
              }
              categories[wordData.category].push(wordData.word);
            });

            const embed = new EmbedBuilder()
              .setColor("#0099ff")
              .setTitle("📚 GGCK어 사전 전체 목록")
              .setDescription("카테고리별 GGCK어 목록입니다.");

            Object.entries(categories).forEach(([category, wordList]) => {
              embed.addFields({
                name: `${category} (${wordList.length}개)`,
                value: wordList.join(", "),
              });
            });

            await interaction.reply({ embeds: [embed] });
          } catch (error) {
            console.error("GGCK어 목록 조회 중 에러 발생:", error);
            await interaction.reply({
              content: "목록 조회 중 에러가 발생했다 쓰바라마!",
              ephemeral: true,
            });
          }
        }
      }
    }

    // 버튼 클릭 처리
    if (interaction.isButton()) {
      try {
        // 맛집 재추천 버튼 처리
        if (interaction.customId.startsWith("reroll_restaurant_")) {
          await interaction.deferUpdate();
          const location = interaction.customId.replace(
            "reroll_restaurant_",
            "",
          );

          try {
            const restaurants = await searchRestaurants(location);

            if (!restaurants || restaurants.length === 0) {
              return await interaction.editReply({
                content: "해당 지역의 맛집 정보를 찾을 수 없습니다.",
                embeds: [],
                components: [],
              });
            }

            const restaurant =
              restaurants[Math.floor(Math.random() * restaurants.length)];
            const embed = createRestaurantEmbed(restaurant, location);
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`reroll_restaurant_${location}`)
                .setLabel("다른 맛집 추천받기")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("🎲"),
            );

            return await interaction.editReply({
              embeds: [embed],
              components: [row],
            });
          } catch (error) {
            console.error("맛집 재검색 중 에러:", error);
            return await interaction.editReply({
              content: "맛집 재검색 중 오류가 발생했습니다.",
              embeds: [],
              components: [],
            });
          }
        }

        // 게임 관련 버튼 처리
        const [action, messageId] = interaction.customId.split("_");
        const gameData = gameParticipants.get(messageId);
        if (!gameData) return;

        // 게임 취소 처리
        if (action === "cancel") {
          if (interaction.member.id !== gameData.hostId) {
            return await interaction.reply({
              content: "니가 만든거 아니자나 쓰바라마!",
              ephemeral: true,
            });
          }

          const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor("#ff0000")
            .setTitle("❌ 모집이 취소됐다!!")
            .setDescription("모집자가 예약을 취소했습니다.");

          // 참가자들에게 DM 전송
          await Promise.all(
            gameData.participantIds.map(async (participantId) => {
              try {
                const user = await client.users.fetch(participantId);
                await user.send({
                  content: `❌ ${gameData.game} 예약이 취소되었습니다.`,
                });
              } catch (error) {
                console.error(
                  `Failed to send cancellation DM to ${participantId}:`,
                  error,
                );
              }
            }),
          );

          const disabledRow = new ActionRowBuilder().addComponents(
            interaction.message.components[0].components.map((button) =>
              ButtonBuilder.from(button).setDisabled(true),
            ),
          );

          await interaction.update({
            embeds: [embed],
            components: [disabledRow],
          });

          if (gameData.useEveryone) {
            await interaction.channel.send({
              content: "❌ 모집이 취소됐다!!",
            });
          }

          cleanupGame(messageId);
          return;
        }

        // 게임 참가 처리
        if (action === "join") {
          if (interaction.member.id === gameData.hostId) {
            return await interaction.reply({
              content: "니는 모집자잖아 쓰바라마!",
              ephemeral: true,
            });
          }

          if (gameData.participantIds.includes(interaction.member.id)) {
            return await interaction.reply({
              content: "니는 이미 참가했는데 쓰바라마!",
              ephemeral: true,
            });
          }

          if (gameData.participants.length >= gameData.maxPlayers) {
            return await interaction.reply({
              content: "꽉찼다!! 늦었다!! 쓰바라마!!!",
              ephemeral: true,
            });
          }

          gameData.participants.push(interaction.member.displayName);
          gameData.participantIds.push(interaction.member.id);
        }

        // 게임 퇴장 처리
        if (action === "leave") {
          if (interaction.member.id === gameData.hostId) {
            return await interaction.reply({
              content: "히히 못 가!",
              ephemeral: true,
            });
          }

          if (!gameData.participantIds.includes(interaction.member.id)) {
            return await interaction.reply({
              content: "참가 하고 눌러라 쓰바라마!",
              ephemeral: true,
            });
          }

          const index = gameData.participants.indexOf(
            interaction.member.displayName,
          );
          if (index > -1) {
            gameData.participants.splice(index, 1);
            gameData.participantIds.splice(index, 1);
          }
        }

        // 인원 가득 참 확인 부분
        if (gameData.participants.length === gameData.maxPlayers) {
          const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor("#00ff00")
            .setTitle("✅ 모집 완료다!!")
            .spliceFields(2, 1, {
              name: "현재 인원",
              value: `${gameData.participants.length}명`,
              inline: true,
            })
            .spliceFields(3, 1, {
              // 이 부분이 예약 시간 필드를 덮어쓰고 있었습니다
              name: "참가자 목록",
              value: gameData.participants
                .map((p, i) => `${i + 1}. ${p}`)
                .join("\n"),
            });

          // setFields를 사용하여 모든 필드를 명시적으로 설정
          embed.setFields(
            { name: "모집자", value: gameData.host, inline: true },
            {
              name: "모집 인원",
              value: `${gameData.maxPlayers}명`,
              inline: true,
            },
            {
              name: "현재 인원",
              value: `${gameData.participants.length}명`,
              inline: true,
            },
            {
              name: "예약 시간",
              value: formatTime(gameData.scheduledTime),
              inline: true,
            },
            {
              name: "참가자 목록",
              value: gameData.participants
                .map((p, i) => `${i + 1}. ${p}`)
                .join("\n"),
            },
          );

          const disabledRow = new ActionRowBuilder().addComponents(
            interaction.message.components[0].components.map((button) =>
              ButtonBuilder.from(button).setDisabled(true),
            ),
          );

          const mentions = gameData.participantIds
            .map((id) => `<@${id}>`)
            .join(", ");

          await interaction.channel.send({
            content: `${mentions}\n모집 완료다!! ${formatTime(gameData.scheduledTime)}까지 모여라!! 🎮`,
            embeds: [embed],
          });

          await interaction.update({
            embeds: [embed],
            components: [disabledRow],
          });
          return;
        }

        // 임베드 업데이트
        const embed = EmbedBuilder.from(
          interaction.message.embeds[0],
        ).setFields(
          { name: "모집자", value: gameData.host, inline: true },
          {
            name: "모집 인원",
            value: `${gameData.maxPlayers}명`,
            inline: true,
          },
          {
            name: "현재 인원",
            value: `${gameData.participants.length}명`,
            inline: true,
          },
          {
            name: "예약 시간",
            value: formatTime(gameData.scheduledTime),
            inline: true,
          },
          {
            name: "참가자 목록",
            value: gameData.participants
              .map((p, i) => `${i + 1}. ${p}`)
              .join("\n"),
          },
        );

        await interaction.update({ embeds: [embed] });
      } catch (error) {
        console.error("상호작용 처리 중 에러:", error);
        try {
          const errorMessage =
            "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: errorMessage, ephemeral: true });
          } else {
            await interaction.followUp({
              content: errorMessage,
              ephemeral: true,
            });
          }
        } catch (e) {
          console.error("에러 메시지 전송 실패:", e);
        }
      }
    }
  } catch (error) {
    console.error("Interaction 처리 중 에러 발생:", error);
    try {
      // 에러 발생 시 사용자에게 알림
      const errorMessage =
        "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      }
    } catch (e) {
      console.error("에러 메시지 전송 실패:", e);
    }
  }
});

// 봇 연결 해제 시 모든 타이머 정리
client.on("disconnect", () => {
  for (const timer of gameTimers.values()) {
    clearTimeout(timer);
  }
  gameTimers.clear();
  gameParticipants.clear();
});

// 예기치 않은 에러 처리
process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  // 심각한 에러 발생 시 프로세스 재시작을 위해 종료
  // PM2 등의 프로세스 매니저를 사용하면 자동으로 재시작됨
  process.exit(1);
});

client.login(process.env.DISCORD_TOKEN);
