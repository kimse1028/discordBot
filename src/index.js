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
                .setDescription('추가 설명을 입력하세요')
                .setRequired(true))
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
            const description = interaction.options.getString('설명') || '추가 설명이 없습니다.';

            const messageId = Date.now().toString();
            gameParticipants.set(messageId, {
                participants: [interaction.member.displayName],
                maxPlayers: players
            });

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`🎮 ${game} 모집 중!`)
                .addFields(
                    { name: '모집 인원', value: `${players}명`, inline: true },
                    { name: '현재 인원', value: '1명', inline: true },
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
                .setLabel('취소하기')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder()
                .addComponents(joinButton, leaveButton);

            await interaction.reply({ embeds: [embed], components: [row] });
        }
    }

    // 버튼 클릭 처리
    if (interaction.isButton()) {
        const [action, messageId] = interaction.customId.split('_');
        const gameData = gameParticipants.get(messageId);
        if (!gameData) return;

        if (action === 'join') {
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

        // 임베드 업데이트
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .spliceFields(1, 1, {
                name: '현재 인원',
                value: `${gameData.participants.length}명`,
                inline: true
            })
            .spliceFields(3, 1, {
                name: '참가자 목록',
                value: gameData.participants.length > 0
                    ? gameData.participants.map((p, i) => `${i + 1}. ${p}`).join('\n')
                    : '아직 참가자가 없습니다.'
            });

        await interaction.update({ embeds: [embed] });
    }
});

client.login(process.env.DISCORD_TOKEN);