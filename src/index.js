const { db, ggckWordsRef } = require("./db/firebase");
const { isAdmin, setAdmin } = require("./db/firebase");
const { Timestamp } = require("firebase-admin/firestore");
const axios = require("axios");

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

// 한국 시간 관련 상수 및 유틸리티 함수들
const KR_TIME_DIFF = 9 * 60 * 60 * 1000; // 한국 시간대 (UTC+9)

// 현재 한국 시간 Date 객체 가져오기
function getCurrentKoreanDate() {
  return new Date(); // 시스템 시간을 그대로 사용
}

// Date 객체를 Firebase Timestamp로 변환 (UTC 기준)
function getKoreanTimestamp(date) {
  return Timestamp.fromDate(date); // 직접 변환
}

// Firebase Timestamp를 한국 시간 Date 객체로 변환
function koreanDateFromTimestamp(timestamp) {
  return timestamp.toDate(); // 직접 변환
}

// 게임 예약 시간 설정 함수
function createScheduledTime(hour, minute) {
  const now = getCurrentKoreanDate();
  const scheduledDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
    0,
  );

  // 현재 시간보다 이전인 경우 다음 날로 설정
  if (scheduledDate.getTime() <= now.getTime()) {
    scheduledDate.setDate(scheduledDate.getDate() + 1);
  }

  return scheduledDate;
}

// 시간 유효성 검사 함수
function isValidTime(scheduledDate) {
  const now = getCurrentKoreanDate();
  const minTime = new Date(now.getTime() + 10 * 60 * 1000); // 현재 시간 + 10분
  return scheduledDate.getTime() > minTime.getTime();
}

// 전역 시간 포맷팅 함수
const formatTime = (date) => {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

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
    { grade: "대길", probability: 5, color: "#FF0000", emoji: "🔱" },
    { grade: "중길", probability: 25, color: "#FFA500", emoji: "🌟" },
    { grade: "소길", probability: 35, color: "#FFFF00", emoji: "⭐" },
    { grade: "흉", probability: 25, color: "#A9A9A9", emoji: "⚠️" },
    { grade: "대흉", probability: 10, color: "#4A4A4A", emoji: "💀" },
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
    ],
  },
  // 각 분야별 메시지
  categories: {
    // 행동 지침 데이터 추가
    study: {
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
      흉: [
        "집중력이 떨어질 수 있으니 주의하세요",
        "기초부터 다시 점검해보는 것이 좋습니다",
      ],
      대흉: [
        "실수하기 쉬운 날입니다. 모든 것을 꼼꼼히 확인하세요",
        "무리한 계획은 피하는 것이 좋습니다",
      ],
    },
    work: {
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
      흉: [
        "의사소통에 오해가 생길 수 있으니 주의하세요",
        "중요한 결정은 미루는 것이 좋습니다",
      ],
      대흉: [
        "중요한 실수가 있을 수 있으니 모든 것을 재확인하세요",
        "새로운 시도는 피하는 것이 좋습니다",
      ],
    },
    money: {
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
      흉: [
        "예상치 못한 지출이 있을 수 있습니다",
        "금전 거래는 신중하게 결정하세요",
      ],
      대흉: [
        "큰 금전적 손실이 있을 수 있으니 모든 거래를 조심하세요",
        "투자나 재테크는 절대 피하세요",
      ],
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

// 운세 생성 함수
function generateFortune(userId) {
  const today = new Date().toISOString().split("T")[0];
  let seed = parseInt(userId + today.replace(/-/g, ""));

  const seedRandom = () => {
    let x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
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

  const getRandomMessage = (category, grade) => {
    const messages = fortuneData.categories[category][grade.grade];
    return messages[Math.floor(seedRandom() * messages.length)];
  };

  // 조언 메시지 선택
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
      if (interaction.commandName === "운세") {
        const fortune = generateFortune(interaction.user.id);
        const embed = createFortuneEmbed(
          fortune,
          interaction.member.displayName,
        );

        let content = null;

        if (fortune.grade.grade === "대흉") {
          content = "오늘은 하루종일 집에서 쉬는건 어떨까요...";
        } else if (fortune.grade.grade === "대길") {
          // 대길일 경우 전체 알림 메시지
          content = `@everyone\n🎊 ${interaction.member.displayName}님께서 대길을 받으셨습니다!! 모두 축하해주세요!! 🎉`;

          // 추가 축하 메시지 채널에 보내기
          try {
            await interaction.channel.send({
              content: `축하합니다! ${interaction.member.displayName}님의 오늘 운세는 ${fortune.grade.emoji} 대길 입니다!!\n행운이 가득한 하루 되세요! 🍀`,
              allowedMentions: { parse: [] }, // 이 메시지에서는 멘션 비활성화
            });
          } catch (error) {
            console.error("축하 메시지 전송 실패:", error);
          }
        }

        await interaction.reply({
          content,
          embeds: [embed],
          allowedMentions: { parse: ["everyone"] }, // @everyone 멘션 활성화
        });
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

        // 디버깅을 위한 로그 추가
        console.log(
          "현재 한국 시간:",
          new Intl.DateTimeFormat("ko-KR", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }).format(getCurrentKoreanDate()),
        );

        console.log(
          "예약된 시간:",
          new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
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
          Math.round(
            (scheduledDate.getTime() - getCurrentKoreanDate().getTime()) /
              (1000 * 60),
          ),
        );

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
              value: formatTime(scheduledDate), // formatTime 함수는 이미 한국 시간으로 변환
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
      const [action, messageId] = interaction.customId.split("_");
      const gameData = gameParticipants.get(messageId);
      if (!gameData) return;

      // 모집 취소 처리
      if (action === "cancel") {
        if (interaction.member.id !== gameData.hostId) {
          await interaction.reply({
            content: "니가 만든거 아니자나 쓰바라마!",
            ephemeral: true,
          });
          return;
        }

        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor("#ff0000")
          .setTitle("❌ 모집이 취소됐다!!")
          .setDescription("모집자가 예약을 취소했습니다.");

        // 참가자들에게 DM으로 취소 알림
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

      // 참가 처리
      if (action === "join") {
        if (interaction.member.id === gameData.hostId) {
          await interaction.reply({
            content: "니는 모집자잖아 쓰바라마!",
            ephemeral: true,
          });
          return;
        }

        if (gameData.participantIds.includes(interaction.member.id)) {
          await interaction.reply({
            content: "니는 이미 참가했는데 쓰바라마!",
            ephemeral: true,
          });
          return;
        }

        if (gameData.participants.length >= gameData.maxPlayers) {
          await interaction.reply({
            content: "꽉찼다!! 늦었다!! 쓰바라마!!!",
            ephemeral: true,
          });
          return;
        }

        gameData.participants.push(interaction.member.displayName);
        gameData.participantIds.push(interaction.member.id);
      }
      // 퇴장 처리
      else if (action === "leave") {
        if (interaction.member.id === gameData.hostId) {
          await interaction.reply({
            content: "히히 못 가!",
            ephemeral: true,
          });
          return;
        }

        if (!gameData.participantIds.includes(interaction.member.id)) {
          await interaction.reply({
            content: "참가 하고 눌러라 쓰바라마!",
            ephemeral: true,
          });
          return;
        }

        const index = gameData.participants.indexOf(
          interaction.member.displayName,
        );
        if (index > -1) {
          gameData.participants.splice(index, 1);
          gameData.participantIds.splice(index, 1);
        }
      }

      // 인원이 다 찼는지 확인
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
            name: "참가자 목록",
            value: gameData.participants
              .map((p, i) => `${i + 1}. ${p}`)
              .join("\n"),
          });

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
      const embed = EmbedBuilder.from(interaction.message.embeds[0]).setFields(
        {
          name: "모집자",
          value: gameData.host,
          inline: true,
        },
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
