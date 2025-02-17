const { db, ggckWordsRef } = require("./db/firebase");
const { isAdmin, setAdmin } = require("./db/firebase");

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
        .setName("월")
        .setDescription("예약할 월을 입력하세요")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(12),
    )
    .addIntegerOption((option) =>
      option
        .setName("일")
        .setDescription("예약할 일을 입력하세요")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(31),
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
    )
    .addStringOption((option) =>
      option
        .setName("분류")
        .setDescription("단어의 분류 (감탄사, 동사, 명사 등)")
        .setRequired(true)
        .addChoices(
          { name: "감탄사", value: "감탄사" },
          { name: "동사", value: "동사" },
          { name: "명사", value: "명사" },
          { name: "형용사", value: "형용사" },
          { name: "부사", value: "부사" },
          { name: "기타", value: "기타" },
        ),
    ),
];

// 게임 데이터와 타이머를 함께 관리
const gameParticipants = new Map();
const gameTimers = new Map();

// 게임 데이터 정리 함수
function cleanupGame(messageId) {
  // 10분 전 알림 타이머 정리
  const preTimer = gameTimers.get(`${messageId}_pre`);
  if (preTimer) {
    clearTimeout(preTimer);
    gameTimers.delete(`${messageId}_pre`);
  }

  // 게임 시작 타이머 정리
  const timer = gameTimers.get(messageId);
  if (timer) {
    clearTimeout(timer);
    gameTimers.delete(messageId);
  }

  // 게임 데이터 제거
  gameParticipants.delete(messageId);
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
      if (interaction.commandName === "게임모집") {
        const game = interaction.options.getString("게임");
        const players = interaction.options.getInteger("인원");
        const description = interaction.options.getString("설명");
        const month = interaction.options.getInteger("월");
        const day = interaction.options.getInteger("일");
        const hour = interaction.options.getInteger("시");
        const minute = interaction.options.getInteger("분");
        const useEveryone = interaction.options.getBoolean("전체알림") ?? false;

        // 현재 년도 가져오기
        const currentYear = new Date().getFullYear();
        const now = new Date();

        // 날짜 유효성 검사 함수
        function isValidDate(date) {
          // 현재 시간보다 최소 10분 이후만 예약 가능하도록
          const minTime = new Date();
          minTime.setMinutes(minTime.getMinutes() + 10);

          return (
            date instanceof Date &&
            !isNaN(date) &&
            date.getMonth() === month - 1 &&
            date.getDate() === day &&
            date > minTime
          );
        }

        // 날짜 유효성 검사
        const scheduledDate = new Date(
          currentYear,
          month - 1,
          day,
          hour,
          minute,
        );

        // 입력된 날짜가 올해의 과거인 경우, 내년으로 설정
        if (scheduledDate < now) {
          scheduledDate.setFullYear(currentYear + 1);
        }

        // 날짜 유효성 검사
        if (!isValidDate(scheduledDate)) {
          await interaction.reply({
            content:
              "유효하지 않은 날짜입니다! (현재 시간 이후, 30일 이내만 가능)",
            ephemeral: true,
          });
          return;
        }

        // 30일 이상 먼 미래는 예약 불가
        const thirtyDaysLater = new Date(
          now.getTime() + 30 * 24 * 60 * 60 * 1000,
        );
        if (scheduledDate > thirtyDaysLater) {
          await interaction.reply({
            content: "30일 이후로는 예약할 수 없습니다!",
            ephemeral: true,
          });
          return;
        }

        const messageId = Date.now().toString();

        gameParticipants.set(messageId, {
          host: interaction.member.displayName,
          hostId: interaction.member.id,
          participants: [interaction.member.displayName],
          participantIds: [interaction.member.id],
          maxPlayers: players,
          scheduledTime: scheduledDate,
          game: game,
          useEveryone: useEveryone,
        });

        const formatDate = (date) => {
          return `${date.getMonth() + 1}월 ${date.getDate()}일 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        };

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
              value: formatDate(scheduledDate),
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

        // 10분 전 알림 타이머 설정
        const preNotificationTime = new Date(
          scheduledDate.getTime() - 10 * 60 * 1000,
        );
        const timeUntilPreNotification =
          preNotificationTime.getTime() - Date.now();

        if (timeUntilPreNotification > 0) {
          const preNotificationTimer = setTimeout(async () => {
            try {
              const gameData = gameParticipants.get(messageId);
              if (!gameData) return;

              // 알림 메시지 생성
              const mentions = gameData.participantIds
                .map((id) => `<@${id}>`)
                .join(", ");

              // 채널에 알림 전송
              await interaction.channel.send({
                content: `${mentions}\n⏰ 10분 후에 ${gameData.game} 시작이다!!`,
                allowedMentions: { parse: ["users"] },
              });

              // DM 전송을 위한 참가자 정보 준비
              const participantsList = gameData.participants.join(", ");

              // 각 참가자에게 DM 전송
              for (const participantId of gameData.participantIds) {
                try {
                  const user = await client.users.fetch(participantId);
                  await user.send({
                    content: `🎮 ${gameData.game} 10분 후 시작!!\n참가자: ${participantsList}\n스@근~하게 드러온나!`,
                  });
                } catch (dmError) {
                  console.error(
                    `Failed to send DM to ${participantId}:`,
                    dmError,
                  );
                  // DM 전송 실패해도 계속 진행
                  continue;
                }
              }
            } catch (error) {
              console.error("10분 전 알림 처리 중 에러 발생:", error);
            }
          }, timeUntilPreNotification);

          // 타이머 저장
          gameTimers.set(`${messageId}_pre`, preNotificationTimer);
        }

        // 타이머 설정
        const timeUntilScheduled = scheduledDate.getTime() - now.getTime();
        const timer = setTimeout(async () => {
          try {
            const gameData = gameParticipants.get(messageId);
            if (
              !gameData ||
              gameData.participants.length >= gameData.maxPlayers
            ) {
              cleanupGame(messageId);
              return;
            }

            const timeoutEmbed = EmbedBuilder.from(embed)
              .setColor("#ff0000")
              .setTitle("⏰ 시간이 되었습니다!")
              .spliceFields(3, 1, {
                name: "상태",
                value: "모집 마감",
                inline: true,
              });

            const disabledRow = new ActionRowBuilder().addComponents(
              row.components.map((button) =>
                ButtonBuilder.from(button).setDisabled(true),
              ),
            );

            // 새 메시지로 시간 초과 알림
            await interaction.channel.send({
              content: gameData.useEveryone
                ? "⏰ 게임 시작 시간이다!!!"
                : "⏰ 게임 시작 시간이다!!!",
              embeds: [timeoutEmbed],
              allowedMentions: { parse: ["everyone"] },
            });

            try {
              await interaction.editReply({
                embeds: [timeoutEmbed],
                components: [disabledRow],
              });
            } catch (error) {
              console.log(
                "원본 메시지 수정 실패 - 이미 삭제되었거나 접근 불가능한 메시지일 수 있습니다.",
              );
            }

            cleanupGame(messageId);
          } catch (error) {
            console.error("예약 시간 처리 중 에러 발생:", error);
            cleanupGame(messageId);
          }
        }, timeUntilScheduled);

        gameTimers.set(messageId, timer);
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

        const formatDate = (date) => {
          return `${date.getMonth() + 1}월 ${date.getDate()}일 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        };

        await interaction.channel.send({
          content: `${mentions}\n모집 완료다!! ${formatDate(gameData.scheduledTime)}까지 모여라!! 🎮`,
          embeds: [embed],
        });

        await interaction.update({
          embeds: [embed],
          components: [disabledRow],
        });
        cleanupGame(messageId);
        return;
      }

      // 임베드 업데이트
      const embed = EmbedBuilder.from(interaction.message.embeds[0])
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

      await interaction.update({ embeds: [embed] });
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
    // GGCK어 검색과 목록 부분의 코드 변경
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
