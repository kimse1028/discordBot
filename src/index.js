const { db, gangchanWordsRef } = require("./db/firebase");
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
        .setName("기간")
        .setDescription("모집 기간 분 단위(최대180분) 입력하세요")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(180),
    )
    .addBooleanOption((option) =>
      option
        .setName("전체알림")
        .setDescription("@everyone으로 전체 알림을 보낼지 선택하세요")
        .setRequired(true),
    ),
  // commands 배열에 추가
  new SlashCommandBuilder()
    .setName("강찬어사전")
    .setDescription("강찬어 사전을 검색하거나 목록을 확인합니다")
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
        .setDescription("전체 강찬어 목록을 확인합니다"),
    ),
  new SlashCommandBuilder()
    .setName("강찬어등록")
    .setDescription("새로운 강찬어를 등록합니다 (관리자 전용)")
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
  // 타이머가 있다면 제거
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
        const duration = interaction.options.getInteger("기간");
        const useEveryone = interaction.options.getBoolean("전체알림") ?? false;

        // @everyone 권한 체크
        if (
          useEveryone &&
          !interaction.guild.members.me.permissions.has(
            PermissionsBitField.Flags.MentionEveryone,
          )
        ) {
          await interaction.reply({
            content:
              "봇에 @everyone 권한이 없습니다. 서버 관리자에게 문의하세요.",
            ephemeral: true,
          });
          return;
        }

        const endTime = Date.now() + duration * 60 * 1000;
        const messageId = Date.now().toString();

        gameParticipants.set(messageId, {
          host: interaction.member.displayName,
          hostId: interaction.member.id,
          participants: [interaction.member.displayName],
          participantIds: [interaction.member.id],
          maxPlayers: players,
          endTime: endTime,
          game: game,
          duration: duration,
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
            { name: "남은 시간", value: `${duration}분`, inline: true },
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

        // 타이머 설정 및 저장
        const timer = setTimeout(
          async () => {
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
                .setTitle("⏰ 시간 초과 !!!")
                .spliceFields(3, 1, {
                  name: "남은 시간",
                  value: "종료",
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
                  ? "⏰ 너가 안 와서 파티 터졌어!!!"
                  : "⏰ 너가 안 와서 파티 터졌어!!!",
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
              console.error("시간 초과 처리 중 에러 발생:", error);
              cleanupGame(messageId);
            }
          },
          duration * 60 * 1000,
        );

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
          .setTitle("❌ 모집이 취소됐다!!");

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
          content: `${mentions}\n모집 완료다!! 게임하자!! 🎮`,
          embeds: [embed],
        });

        // DM 전송을 Promise.all로 처리
        await Promise.all(
          gameData.participantIds.map(async (participantId) => {
            try {
              const user = await client.users.fetch(participantId);
              await user.send({
                content: `🎮 ${gameData.game} 모집 완료!!\n${gameData.participants.join(", ")}\n 스@근~하게 드러온나!`,
              });
            } catch (error) {
              console.error(`Failed to send DM to ${participantId}:`, error);
            }
          }),
        );

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

    // 강찬어 등록
    if (interaction.commandName === "강찬어등록") {
      // 관리자 권한 체크
      if (!(await isAdmin(interaction.user.id, interaction.guildId))) {
        await interaction.reply({
          content: "강찬어는 서버 주인만 등록할 수 있다 쓰바라마!",
          ephemeral: true,
        });
        return;
      }

      const word = interaction.options.getString("단어");
      const meaning = interaction.options.getString("의미");
      const example = interaction.options.getString("예문");
      const category = interaction.options.getString("분류");

      try {
        // 기존 단어 검색
        const wordDoc = await gangchanWordsRef.doc(word).get();

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
        await gangchanWordsRef.doc(word).set({
          word,
          meaning,
          example,
          category,
          addedBy: interaction.user.tag,
          addedAt: new Date(),
          isActive: true,
        });

        const embed = new EmbedBuilder()
          .setColor("#00ff00")
          .setTitle("✅ 강찬어 등록 완료!")
          .addFields(
            { name: "단어", value: word },
            { name: "의미", value: meaning },
            { name: "예문", value: example },
            { name: "분류", value: category },
          );

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error("강찬어 등록 중 에러 발생:", error);
        await interaction.reply({
          content: "등록 중 에러가 발생했다 쓰바라마!",
          ephemeral: true,
        });
      }
    }

    // 강찬어 검색
    // 강찬어 검색과 목록 부분의 코드 변경
    if (interaction.commandName === "강찬어사전") {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "검색") {
        const searchWord = interaction.options.getString("단어");

        try {
          const wordDoc = await gangchanWordsRef.doc(searchWord).get();

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
              { name: "분류", value: wordData.category },
            )
            .setFooter({ text: "강찬어 사전 Ver 1.0" });

          await interaction.reply({ embeds: [embed] });
        } catch (error) {
          console.error("강찬어 검색 중 에러 발생:", error);
          await interaction.reply({
            content: "검색 중 에러가 발생했다 쓰바라마!",
            ephemeral: true,
          });
        }
      } else if (subcommand === "목록") {
        try {
          const snapshot = await gangchanWordsRef
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
            .setTitle("📚 강찬어 사전 전체 목록")
            .setDescription("카테고리별 강찬어 목록입니다.");

          Object.entries(categories).forEach(([category, wordList]) => {
            embed.addFields({
              name: `${category} (${wordList.length}개)`,
              value: wordList.join(", "),
            });
          });

          await interaction.reply({ embeds: [embed] });
        } catch (error) {
          console.error("강찬어 목록 조회 중 에러 발생:", error);
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
