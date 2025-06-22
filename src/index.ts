import { config } from 'dotenv';
import { Client as DiscordClient, GatewayIntentBits} from 'discord.js';
import { Client as HiveClient } from '@hiveio/dhive';
import { getUserCsiScore } from './util/csi';

config(); // Load .env variables

const HIVE_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://api.deathwing.me',
  'https://hive-api.arcange.eu',
  'https://anyx.io',
  'https://techcoderx.com'
];
let currentNodeIndex = 0;
let currentNode: HiveClient;

const getNextHiveClient = () => {
  currentNodeIndex = (currentNodeIndex + 1) % HIVE_NODES.length;
  console.log(`Switching to Hive node: ${HIVE_NODES[currentNodeIndex]}`);
  currentNode = new HiveClient(HIVE_NODES[currentNodeIndex]);
  return currentNode;
};

const getHiveClient = () => {
  if (!currentNode) {
    return getNextHiveClient();
  }
  return currentNode;
}

async function convertVestToHive (amount: number) {
  const hiveClient = getHiveClient();
  const globalProperties = await hiveClient.call('condenser_api', 'get_dynamic_global_properties', []);
  const totalVestingFund = extractNumber(globalProperties.total_vesting_fund_hive)
  const totalVestingShares = extractNumber(globalProperties.total_vesting_shares)
  const vestHive = ( totalVestingFund * amount ) / totalVestingShares
  return vestHive
}

function extractNumber(value: string): number {

  const match = value.match(/([\d.]+)/);
  return match ? parseFloat(match[0]) : 0;
}

async function getUserInfo(author: string): Promise<{
  hive: number;
  hbd: number;
  hbdSaving: number;
  hp: number;
  delegatedHp: number;
  receivedHp: number;
  ke: number;
  isPD: number;
  vestingShares: number;
  delegatedVestingShares: number;
} | null> {
  const hiveClient = getHiveClient();
  try {
    const [accountData] = await hiveClient.database.getAccounts([author]);
    if (accountData) {
      const hive = extractNumber(String(accountData.balance));
      const hbd = extractNumber(String(accountData.hbd_balance));
      const hbdSaving = extractNumber(String(accountData.savings_hbd_balance));
      const hp = await convertVestToHive(extractNumber(String(accountData.vesting_shares)));
      const delegatedHp = await convertVestToHive(extractNumber(String(accountData.delegated_vesting_shares)));
      const receivedHp = await convertVestToHive(extractNumber(String(accountData.received_vesting_shares)));
      const ke = ((Number(accountData.curation_rewards) + Number(accountData.posting_rewards)) / 1000) / hp;
      const pdRate = extractNumber(String(accountData.vesting_withdraw_rate));
      const isPD = pdRate > 0 ? 1 : 0;

      return {
        hive,
        hbd,
        hbdSaving,
        hp,
        delegatedHp,
        receivedHp,
        ke,
        isPD,
        vestingShares: extractNumber(String(accountData.vesting_shares)),
        delegatedVestingShares: extractNumber(String(accountData.delegated_vesting_shares))
      };
    } else {
      console.log(`No account data found for @${author}`);
      return null;
    }
  } catch (error) {
    console.error(`Failed to fetch wallet info for @${author}:`, error);
    return null;
  }
}

async function getSelfVotesByAuthor(author: string, type: 'post' | 'comment', startPermlink: string = '', allItems: any[] = [], selfVoteCount: number = 0, rewardAppCount: number = 0): Promise<{ items: any[], totalItems: number, totalSelfVotes: number, totalRewardApp: number }> {
  const hiveClient = getHiveClient();
  try {
    let items: any[];
    if (type === 'post') {
      items = await hiveClient.database.call('get_discussions_by_author_before_date', [
        author,
        startPermlink,
        '',
        10
      ]); // Fetch the latest 100 posts by the author
    } else {
      items = await hiveClient.database.call('get_discussions_by_comments', [
        author,
        startPermlink,
        100
      ]); // Fetch the latest 100 comments by the author
    }

    if (items.length === 0) {
      return { items: allItems, totalItems: allItems.length, totalSelfVotes: selfVoteCount, totalRewardApp: rewardAppCount };
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const item of items) {
      const itemDate = new Date(item.created);
      if (itemDate >= thirtyDaysAgo) {
        allItems.push(item);
        const hasSelfVote = item.active_votes.some((vote: any) => vote.voter === author);
        if (hasSelfVote) {
          selfVoteCount++;
        }
        const hasRewardApp = item.beneficiaries && item.beneficiaries.some((beneficiary: any) => beneficiary.account === 'reward.app');
        if (hasRewardApp) {
          rewardAppCount++;
        }
        //console.log(`${type.charAt(0).toUpperCase() + type.slice(1)} by @${author} on ${item.permlink} - ${item.created} has self-vote: ${hasSelfVote}, reward.app: ${hasRewardApp}`);
      } else {
        return { items: allItems, totalItems: allItems.length, totalSelfVotes: selfVoteCount, totalRewardApp: rewardAppCount }; // Stop if the item is older than 30 days
      }
    }

    const lastItem = items[items.length - 1];
    return getSelfVotesByAuthor(author, type, lastItem.permlink, allItems, selfVoteCount, rewardAppCount); // Recursive call with the last item's permlink
  } catch (error) {
    console.error(`Error fetching ${type}s by @${author}:`, error);
    return { items: allItems, totalItems: allItems.length, totalSelfVotes: selfVoteCount, totalRewardApp: rewardAppCount };
  }
}

const discordClient = new DiscordClient({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

discordClient.once('ready', async () => {
  console.log(`Logged in as ${discordClient.user?.tag}!`);
  //streamBlockchain();
});

discordClient.on('messageCreate', async (message) => {
  if (message.content.startsWith('!user')) {
    const user = message.content.split(' ')[1];
    if (user) {
      let totalVote = 0;
      const userInfo = await getUserInfo(user);
      //const posts = await getPostsByAuthor(user);
      //const comments = await getCommentsByAuthor(user);
      const selfVotes = await getSelfVotesByAuthor(user, 'post');
      const selfComments = await getSelfVotesByAuthor(user, 'comment'); // Fetch self-votes on comments as well
      const csi = await getUserCsiScore(user);
      if (userInfo) {
        const percentageDelegated = (userInfo.delegatedVestingShares / userInfo.vestingShares) * 100;

        const embed = {
          color: 0x0099ff, // Blue color
          title: `@${user}`,
          url: `https://peakd.com/@${user}`,
          thumbnail: { url: `https://images.hive.blog/u/${user}/avatar` },
          fields: [
            //{ name: '**Hive**', value: `${userInfo.hive.toFixed(3)}`, inline: true },
            { name: '**HP**', value: `${userInfo.hp.toFixed(3)}`, inline: true },
            //{ name: "", value: ``, inline:  true },
            //{ name: "", value: ``, inline:  false },
            { name: '**HP Delegated**', value: `${userInfo.delegatedHp.toFixed(3)} (${percentageDelegated.toFixed(2)}%)`, inline: true },
            //{ name: '**HP Received**', value: `${userInfo.receivedHp.toFixed(3)}`, inline: true },
            //{ name: '**% Delegated**', value: `${percentageDelegated.toFixed(2)}%`, inline: true },
            //{ name: "", value: ``, inline:  false },
            //{ name: '**HBD**', value: `${userInfo.hbd.toFixed(3)}`, inline: true },
            //{ name: '**HBD Savings**', value: `${userInfo.hbdSaving.toFixed(3)}`, inline: true },
            { name: "", value: ``, inline:  true },
            { name: "", value: ``, inline:  false },
            { name: '**KE**', value: `${userInfo.ke.toFixed(3)}`, inline: true },
            { name: '**Power Down**', value: `${userInfo.isPD ? 'Yes' : 'No'}`, inline: true },
            { name: "", value: ``, inline:  true },
            { name: "", value: ``, inline:  false },
            { name: '**Posts 30 days**', value: `${selfVotes.totalItems}`, inline: true },
            { name: '**reward.app**', value: `${selfVotes.totalRewardApp}`, inline:  true },
            { name: '**Self Votes**', value: `${selfVotes.totalSelfVotes}`, inline: true },
            { name: "", value: ``, inline:  false },
            { name: '**Comments 30 days**', value: `${selfComments.totalItems}`, inline: true },
            { name: '**reward.app**', value: `${selfComments.totalRewardApp}`, inline:  true },
            { name: '**Self Votes**', value: `${selfComments.totalSelfVotes}`, inline: true },
            { name: "", value: ``, inline:  false },
            { name: '**CSI Score 30 days**', value: `${csi?.csi}`, inline: true },
          ],
          footer: { text: `Requested by ${message.author.displayName}`, icon_url: message.author.displayAvatarURL() }
        };
  
        message.channel.send({ embeds: [embed] }); // Sends the message normally in the channel
      } else {
        message.channel.send(`No account data found for @${user}`);
      }
    } else {
      message.channel.send('Please specify a user to get info.');
    }
  } else if (message.content === '!ping') {
    message.reply('Pong!');
  }
});

discordClient.login(process.env.DISCORD_TOKEN);
