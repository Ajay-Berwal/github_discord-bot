import dotenv from 'dotenv';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import fetch from 'node-fetch';

dotenv.config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const githubToken = process.env.GITHUB_TOKEN;
let lastQueriedUsername = null; // Store the last queried username for !gssoc command

client.once('ready', () => {
    console.log('Bot is online!');
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Handle the !github command
    if (message.content.startsWith('!github')) {
        const args = message.content.split(' ');
        const username = args[1];

        if (!username) {
            return message.channel.send('Please provide a valid GitHub username!');
        }

        lastQueriedUsername = username; // Store username for subsequent !gssoc commands

        message.channel.send('Fetching data... Please wait!').then(async (loadingMessage) => {
            try {
                const { avatar_url } = await fetchUserProfile(username);
                const { openPRs, todayMergedPRs, mergedPRs, todayScore, allTimeMergedPRs, assignedIssues } = await loadData(username);

                const allTimeScore = calculateTotalScore(allTimeMergedPRs);
                const scoreEmbed = buildScoreEmbed(username, avatar_url, openPRs.length, todayMergedPRs.length, mergedPRs.length, todayScore, allTimeScore, assignedIssues.length);
                loadingMessage.delete();
                const sentMessage = await message.channel.send({ embeds: [scoreEmbed] });

                // Add reactions for different PR levels
                await sentMessage.react('1️⃣');
                await sentMessage.react('2️⃣');
                await sentMessage.react('3️⃣');

                // Reaction listener
                const filter = (reaction, user) => {
                    return ['1️⃣', '2️⃣', '3️⃣'].includes(reaction.emoji.name) && !user.bot;
                };

                const collector = sentMessage.createReactionCollector({ filter, time: 60000 });

                collector.on('collect', async (reaction, user) => {
                    if (reaction.emoji.name === '1️⃣') {
                        const level1PRs = todayMergedPRs.filter(pr => pr.labels.some(label => label.name.toLowerCase() === 'level1'));
                        const level1Embed = buildLevelEmbed(level1PRs, 'Level 1 PRs', user.username);
                        await message.channel.send({ embeds: [level1Embed] });
                    } else if (reaction.emoji.name === '2️⃣') {
                        const level2PRs = todayMergedPRs.filter(pr => pr.labels.some(label => label.name.toLowerCase() === 'level2'));
                        const level2Embed = buildLevelEmbed(level2PRs, 'Level 2 PRs', user.username);
                        await message.channel.send({ embeds: [level2Embed] });
                    } else if (reaction.emoji.name === '3️⃣') {
                        const level3PRs = todayMergedPRs.filter(pr => pr.labels.some(label => label.name.toLowerCase() === 'level3'));
                        const level3Embed = buildLevelEmbed(level3PRs, 'Level 3 PRs', user.username);
                        await message.channel.send({ embeds: [level3Embed] });
                    }
                });

            } catch (error) {
                console.error(`Error fetching data for ${username}:`, error);
                loadingMessage.delete();
                message.channel.send('An error occurred while fetching data. Please try again later.');
            }
        });
    }

    // Handle the !gssoc command
    if (message.content.startsWith('!gssoc')) {
        const args = message.content.split(' ');
        const username = args[1] || lastQueriedUsername;

        if (!username) {
            return message.channel.send('Please use the !github command first or provide a username.');
        }

        message.channel.send(`Fetching GSSoC data for ${username}... Please wait!`).then(async (loadingMessage) => {
            try {
                const { mergedPRs, openPRs, assignedIssues } = await loadData(username);

                // Filtering based on GSSoC label
                const gssocAssignedPRs = assignedIssues.filter(pr => pr.labels.some(label => label.name.toLowerCase() === 'gssoc-ext'));
                const gssocOpenPRs = openPRs.filter(pr => pr.labels.some(label => label.name.toLowerCase() === 'gssoc-ext'));
                const gssocMergedPRs = mergedPRs.filter(pr => pr.labels.some(label => label.name.toLowerCase() === 'gssoc-ext'));

                // Count GSSoC PRs by level
                const levelCounts = {
                    level1: gssocMergedPRs.filter(pr => pr.labels.some(label => label.name.toLowerCase() === 'level1')).length,
                    level2: gssocMergedPRs.filter(pr => pr.labels.some(label => label.name.toLowerCase() === 'level2')).length,
                    level3: gssocMergedPRs.filter(pr => pr.labels.some(label => label.name.toLowerCase() === 'level3')).length
                };

                // Construct embed with new GSSoC stats
                const gssocEmbed = new EmbedBuilder()
                    .setColor(0x6a0dad)
                    .setTitle(`🚀 **GSSoC Stats for ${username}** 🚀`)
                    .setThumbnail(`https://github.com/${username}.png`)
                    .addFields(
                        { name: '👤 **Profile**', value: `[Click here](https://github.com/${username})` },
                        { name: '✨ **GSSoC PRs Overview** ✨', value: '\u200b' },
                        { name: '📑 Total GSSoC PRs:', value: gssocMergedPRs.length.toString(), inline: true },
                        { name: '📦 Assigned GSSoC PRs:', value: gssocAssignedPRs.length.toString(), inline: true },
                        { name: '🔄 Open GSSoC PRs:', value: gssocOpenPRs.length.toString(), inline: true },
                        { name: '⚙️ Level 1 GSSoC PRs:', value: levelCounts.level1.toString(), inline: true },
                        { name: '⚙️ Level 2 GSSoC PRs:', value: levelCounts.level2.toString(), inline: true },
                        { name: '⚙️ Level 3 GSSoC PRs:', value: levelCounts.level3.toString(), inline: true }
                    );

                loadingMessage.delete();
                message.channel.send({ embeds: [gssocEmbed] });
            } catch (error) {
                console.error(`Error fetching GSSoC data for ${username}:`, error);
                loadingMessage.delete();
                message.channel.send('An error occurred while fetching GSSoC data. Please try again later.');
            }
        });
    }

    // Handle the !compare command
    if (message.content.startsWith('!compare')) {
        // Expected format: !compare username1 vs username2
        const args = message.content.slice('!compare'.length).trim();

        // Split by ' vs ' (case insensitive)
        const compareRegex = /(\S+)\s+vs\s+(\S+)/i;
        const match = args.match(compareRegex);

        if (!match) {
            return message.channel.send('Please use the correct format: `!compare <username1> vs <username2>`');
        }

        const username1 = match[1];
        const username2 = match[2];

        message.channel.send(`Fetching comparison data for ${username1} vs ${username2}... Please wait!`).then(async (loadingMessage) => {
            try {
                // Fetch data for both users in parallel
                const [user1Profile, user1Data, user2Profile, user2Data] = await Promise.all([
                    fetchUserProfile(username1),
                    loadData(username1),
                    fetchUserProfile(username2),
                    loadData(username2)
                ]);

                // Check if both users exist
                if (!user1Profile || !user2Profile) {
                    throw new Error('One or both usernames are invalid.');
                }

                // Build comparison stats
                const user1AllTimeScore = calculateTotalScore(user1Data.allTimeMergedPRs);
                const user2AllTimeScore = calculateTotalScore(user2Data.allTimeMergedPRs);

                const compareEmbed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle(`📊 **GitHub Stats: ${username1} vs ${username2}** 📊`)
                    .addFields(
                        { name: '👤 **Profile**', value: `[${username1}](https://github.com/${username1}) vs [${username2}](https://github.com/${username2})`, inline: false },
                        { name: '📑 **Total Open PRs**', value: `${username1}: ${user1Data.openPRs.length}\n${username2}: ${user2Data.openPRs.length}`, inline: true },
                        { name: '✅ **Total Merged PRs**', value: `${username1}: ${user1Data.mergedPRs.length}\n${username2}: ${user2Data.mergedPRs.length}`, inline: true },
                        { name: '📅 **Merged PRs Today**', value: `${username1}: ${user1Data.todayMergedPRs.length}\n${username2}: ${user2Data.todayMergedPRs.length}`, inline: true },
                        { name: '💰 **Daily Score**', value: `${username1}: ${user1Data.todayScore}\n${username2}: ${user2Data.todayScore}`, inline: true },
                        { name: '🏆 **Total Score**', value: `${username1}: ${user1AllTimeScore}\n${username2}: ${user2AllTimeScore}`, inline: true },
                        { name: '📝 **Assigned Issues**', value: `${username1}: ${user1Data.assignedIssues.length}\n${username2}: ${user2Data.assignedIssues.length}`, inline: true }
                    )
                    .setTimestamp();

                loadingMessage.delete();
                message.channel.send({ embeds: [compareEmbed] });

            } catch (error) {
                console.error(`Error comparing data for ${username1} vs ${username2}:`, error);
                loadingMessage.delete();
                message.channel.send('An error occurred while fetching comparison data. Please ensure both usernames are correct.');
            }
        });
    }

});

// Helper functions

async function fetchUserProfile(username) {
    const response = await fetch(`https://api.github.com/users/${username}`, {
        headers: { Authorization: `token ${githubToken}` }
    });

    if (!response.ok) throw new Error(`Failed to fetch user profile for ${username}. Status: ${response.status}`);
    return response.json();
}

async function loadData(username) {
    const today = new Date().toISOString().split('T')[0];

    const queries = {
        assignedIssues: `search/issues?q=is:issue+assignee:${username}+state:open&sort=created&order=desc`,
        openPRs: `search/issues?q=is:pull-request+author:${username}+state:open&sort=created&order=desc`,
        mergedPRs: `search/issues?q=is:pull-request+author:${username}+state:closed+is:merged&sort=created&order=desc`,
        todayMergedPRs: `search/issues?q=is:pull-request+author:${username}+state:closed+is:merged+merged:${today}&sort=created&order=desc`
    };

    try {
        const [assignedIssues, openPRs, mergedPRs, todayMergedPRs] = await Promise.all(
            Object.values(queries).map(query => fetchPaginatedData(`https://api.github.com/${query}`))
        );

        const allTimeMergedPRs = mergedPRs;
        const todayScore = calculateDailyScores(todayMergedPRs);
        return { assignedIssues, openPRs, mergedPRs, todayMergedPRs, allTimeMergedPRs, todayScore };
    } catch (error) {
        throw error;
    }
}

async function fetchPaginatedData(url) {
    let data = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
        const response = await fetch(`${url}&page=${page}&per_page=100`, {
            headers: { Authorization: `token ${githubToken}` }
        });

        if (!response.ok) throw new Error(`Failed to fetch data from ${url}. Status: ${response.status}`);
        const json = await response.json();
        data = [...data, ...json.items];
        hasNextPage = json.items.length === 100;
        page++;
    }
    return data;
}

function calculateDailyScores(mergedPRs) {
    const labelPoints = {
        level1: 10,
        level2: 25,
        level3: 45
    };

    return mergedPRs.reduce((score, pr) => {
        pr.labels.forEach(label => {
            const labelName = label.name.toLowerCase();
            if (labelPoints[labelName]) {
                score += labelPoints[labelName];
            }
        });
        return score;
    }, 0);
}

function calculateTotalScore(mergedPRs) {
    const labelPoints = {
        level1: 10,
        level2: 25,
        level3: 45
    };

    return mergedPRs.reduce((score, pr) => {
        pr.labels.forEach(label => {
            const labelName = label.name.toLowerCase();
            if (labelPoints[labelName]) {
                score += labelPoints[labelName];
            }
        });
        return score;
    }, 0);
}

function buildScoreEmbed(username, avatar_url, totalPRs, mergedToday, totalMerged, todayScore, allTimeScore, assignedIssues) {
    return new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`**Stats for ${username}**`)
        .setThumbnail(avatar_url)
        .addFields(
            { name: '👤 **Profile**', value: `[Click here](https://github.com/${username})` },
            { name: '✨ **Overview** ✨', value: '\u200b' },
            { name: '📑 Total Open PRs:', value: totalPRs.toString(), inline: true },
            { name: '📦 Merged PRs Today:', value: mergedToday.toString(), inline: true },
            { name: '✅ Total Merged PRs:', value: totalMerged.toString(), inline: true },
            { name: '💰 Daily Score:', value: todayScore.toString(), inline: true },
            { name: '🏆 Total Score:', value: allTimeScore.toString(), inline: true },
            { name: '📝 Assigned Issues:', value: assignedIssues.toString(), inline: true }
        );
}

function buildLevelEmbed(prs, title, username) {
    return new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle(`${title} - ${username}`)
        .setDescription(prs.map(pr => `- [${pr.title}](${pr.html_url})`).join('\n') || 'No PRs found.');
}

client.login(process.env.DISCORD_TOKEN);
