const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

// 슬래시 커맨드 정의
const commands = [
    new SlashCommandBuilder()
        .setName('게임모집')
        .setDescription('게임 참가자를 모집합니다')
        .addStringOption(option =>
            option.setName('게임')
                .setDescription('게임 이름을 입력하세요')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('인원')
                .setDescription('모집 인원을 입력하세요')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('설명')
                .setDescription('게임 설명이나 하고 싶은 말을 입력하세요')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('기간')
                .setDescription('모집 기간 분 단위(최대180분) 입력하세요')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(180))
];

// 준비되면 실행
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // 슬래시 커맨드 등록
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('슬래시 커맨드가 등록되었습니다!');
    } catch (error) {
        console.error(error);
    }
});

// 참가자 목록을 저장할 Map
const gameParticipants = new Map();

// 슬래시 커맨드 처리
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() && !interaction.isButton()) return;

    // 슬래시 커맨드 처리
    if (interaction.isCommand()) {
        if (interaction.commandName === '게임모집') {
            const game = interaction.options.getString('게임');
            const players = interaction.options.getInteger('인원');
            const description = interaction.options.getString('설명');
            const duration = interaction.options.getInteger('기간');
            const endTime = Date.now() + (duration * 60 * 1000);

            const messageId = Date.now().toString();
            gameParticipants.set(messageId, {
                host: interaction.member.displayName,
                hostId: interaction.member.id,
                participants: [interaction.member.displayName],
                participantIds: [interaction.member.id],
                maxPlayers: players,
                endTime: endTime,
                game: game,
                duration: duration // 시간값 저장
            });

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`🎮 ${game} 모집 중!`)
                .addFields(
                    { name: '모집자', value: interaction.member.displayName, inline: true },
                    { name: '모집 인원', value: `${players}명`, inline: true },
                    { name: '현재 인원', value: '1명', inline: true },
                    { name: '남은 시간', value: `${duration}분`, inline: true },
                    { name: '설명', value: description },
                    { name: '참가자 목록', value: `1. ${interaction.member.displayName}` }
                )
                .setTimestamp();

            const joinButton = new ButtonBuilder()
                .setCustomId(`join_${messageId}`)
                .setLabel('참가하기')
                .setStyle(ButtonStyle.Primary);

            const leaveButton = new ButtonBuilder()
                .setCustomId(`leave_${messageId}`)
                .setLabel('도망가기')
                .setStyle(ButtonStyle.Secondary);

            const cancelButton = new ButtonBuilder()
                .setCustomId(`cancel_${messageId}`)
                .setLabel('모집 취소하기')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder()
                .addComponents(joinButton, leaveButton, cancelButton);

            const reply = await interaction.reply({
                embeds: [embed],
                components: [row],
                fetchReply: true
            });

            // 타이머 설정
            setTimeout(async () => {
                const gameData = gameParticipants.get(messageId);
                if (!gameData || gameData.participants.length >= gameData.maxPlayers) return;

                try {
                    const timeoutEmbed = EmbedBuilder.from(embed)
                        .setColor('#ff0000')
                        .setTitle('⏰ 시간 초과로 모집이 종료되었습니다!')
                        .spliceFields(3, 1, { name: '남은 시간', value: '종료', inline: true });

                    const disabledRow = new ActionRowBuilder()
                        .addComponents(
                            row.components.map(button =>
                                ButtonBuilder.from(button).setDisabled(true)
                            )
                        );

                    // 새 메시지로 시간 초과 알림
                    await interaction.channel.send({
                        content: '⏰ 시간이 초과되어 파티가 해산되었습니다.',
                        embeds: [timeoutEmbed]
                    });

                    try {
                        // 원본 메시지 수정 시도
                        await interaction.editReply({
                            embeds: [timeoutEmbed],
                            components: [disabledRow]
                        });
                    } catch (error) {
                        console.log('원본 메시지 수정 실패 - 이미 삭제되었거나 접근 불가능한 메시지일 수 있습니다.');
                    }
                } catch (error) {
                    console.error('시간 초과 처리 중 에러 발생:', error);
                }
            }, duration * 60 * 1000);
        }
    }

    // 버튼 클릭 처리
    if (interaction.isButton()) {
        const [action, messageId] = interaction.customId.split('_');
        const gameData = gameParticipants.get(messageId);
        if (!gameData) return;

        // 모집 취소 처리 (모집자 전용)
        if (action === 'cancel') {
            if (interaction.member.displayName !== gameData.host) {
                await interaction.reply({
                    content: '모집자만 모집을 취소할 수 있습니다!',
                    ephemeral: true
                });
                return;
            }

            const embed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('#ff0000')
                .setTitle('❌ 모집이 취소되었습니다');

            // 모든 버튼 비활성화
            const disabledRow = new ActionRowBuilder()
                .addComponents(
                    interaction.message.components[0].components.map(button =>
                        ButtonBuilder.from(button).setDisabled(true)
                    )
                );

            await interaction.update({ embeds: [embed], components: [disabledRow] });
            return;
        }

        if (action === 'join') {
            // 모집자는 참가할 수 없음
            if (interaction.member.displayName === gameData.host) {
                await interaction.reply({
                    content: '모집자는 이미 참가되어 있습니다!',
                    ephemeral: true
                });
                return;
            }

            // 이미 참가한 사람인지 확인
            if (gameData.participants.includes(interaction.member.displayName)) {
                await interaction.reply({
                    content: '이미 참가하셨습니다!',
                    ephemeral: true
                });
                return;
            }

            // 인원 초과 확인
            if (gameData.participants.length >= gameData.maxPlayers) {
                await interaction.reply({
                    content: '인원이 가득 찼습니다!',
                    ephemeral: true
                });
                return;
            }

            // 참가자 추가
            gameData.participants.push(interaction.member.displayName);
        }
        else if (action === 'leave') {
            // 모집자는 나갈 수 없음
            if (interaction.member.displayName === gameData.host) {
                await interaction.reply({
                    content: '모집자는 나갈 수 없습니다! 대신 모집을 취소할 수 있습니다.',
                    ephemeral: true
                });
                return;
            }

            // 참가하지 않은 사람인지 확인
            if (!gameData.participants.includes(interaction.member.displayName)) {
                await interaction.reply({
                    content: '참가하지 않으셨습니다!',
                    ephemeral: true
                });
                return;
            }

            // 참가자 제거
            gameData.participants = gameData.participants.filter(
                name => name !== interaction.member.displayName
            );
        }

        // 인원이 다 찼는지 확인
        if (gameData.participants.length === gameData.maxPlayers) {
            const embed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('#00ff00')
                .setTitle('✅ 모집 완료!')
                .spliceFields(2, 1, {
                    name: '현재 인원',
                    value: `${gameData.participants.length}명`,
                    inline: true
                })
                .spliceFields(3, 1, {
                    name: '참가자 목록',
                    value: gameData.participants.map((p, i) => `${i + 1}. ${p}`).join('\n')
                });

            // 모든 버튼 비활성화
            const disabledRow = new ActionRowBuilder()
                .addComponents(
                    interaction.message.components[0].components.map(button =>
                        ButtonBuilder.from(button).setDisabled(true)
                    )
                );

            // 채널에 완료 메시지 전송
            await interaction.channel.send({
                content: `${gameData.participants.map(p => `<@${interaction.member.id}>`).join(', ')}\n모집이 완료되었습니다! 게임을 시작하세요! 🎮`,
                embeds: [embed]
            });

            // 참가자들에게 개인 메시지 전송
            for (let i = 0; i < gameData.participantIds.length; i++) {
                try {
                    const user = await client.users.fetch(gameData.participantIds[i]);
                    await user.send({
                        content: `🎮 ${gameData.game} 파티 모집이 완료되었습니다!\n참가자: ${gameData.participants.join(', ')}\n게임 시작 준비를 해주세요!`,
                    });
                } catch (error) {
                    console.error(`Failed to send DM to ${gameData.participants[i]}:`, error);
                }
            }

            await interaction.update({ embeds: [embed], components: [disabledRow] });
            return;
        }

        // 임베드 업데이트
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .spliceFields(2, 1, {
                name: '현재 인원',
                value: `${gameData.participants.length}명`,
                inline: true
            })
            .spliceFields(3, 1, {
                name: '참가자 목록',
                value: gameData.participants.map((p, i) => `${i + 1}. ${p}`).join('\n')
            });

        await interaction.update({ embeds: [embed] });
    }
});

client.login(process.env.DISCORD_TOKEN);