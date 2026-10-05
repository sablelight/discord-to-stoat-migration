import { Client as DiscordClient, ChannelType } from "discord.js";
import { Client as StoatClient } from "stoat.js";

const {
  DISCORD_TOKEN,
  STOAT_TOKEN,
  DISCORD_SERVER_ID,
  STOAT_SERVER_ID: EXISTING_SERVER_ID,
  MESSAGE_LIMIT = "0",
} = process.env;

if (!DISCORD_TOKEN || !STOAT_TOKEN || !DISCORD_SERVER_ID) {
  console.error("Missing required env: DISCORD_TOKEN, STOAT_TOKEN, DISCORD_SERVER_ID");
  process.exit(1);
}

const MSG_LIMIT = parseInt(MESSAGE_LIMIT, 10);
const COPY_MSGS = MSG_LIMIT > 0;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RATELIMIT_DELAY = 350;

const stoatClient = new StoatClient();
const discordClient = new DiscordClient({
  intents: ["Guilds", "GuildMessages", "MessageContent", "GuildMembers"],
});

const chMap = new Map();
const discordChannels = [];
const discordCategories = [];

async function fetchDiscord(guildId) {
  const guild = await discordClient.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  const sorted = [...channels.values()].sort((a, b) => a.position - b.position);
  for (const ch of sorted) {
    if (ch.type === ChannelType.GuildCategory) {
      discordCategories.push(ch);
    } else if (
      ch.type === ChannelType.GuildText ||
      ch.type === ChannelType.GuildVoice ||
      ch.type === ChannelType.GuildAnnouncement ||
      ch.type === ChannelType.GuildStageVoice ||
      ch.type === ChannelType.GuildForum
    ) {
      discordChannels.push(ch);
    }
  }
  console.log(`[Discord] Server: ${guild.name} | ${discordCategories.length} categories, ${discordChannels.length} channels`);
  return guild;
}

async function createServer(guild) {
  console.log(`\n[Stoat] Creating server...`);
  const res = await stoatClient.api.post("/servers/create", {
    name: guild.name,
    description: guild.description || undefined,
  });
  console.log(`[Stoat] Server: ${res.server.name} (${res.server._id})`);

  for (const ch of res.channels) {
    chMap.set(ch.name, ch);
  }
  return res.server;
}

function sanitizeName(name) {
  return name
    .replace(/\s+/g, "-")
    .replace(/[^\w\-\u{0080}-\u{10FFFF}]/gu, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "channel";
}

async function createChannels(serverId) {
  const catNames = new Map(discordCategories.map((c) => [c.id, c.name]));

  for (const dch of discordChannels) {
    const isVoice = dch.type === ChannelType.GuildVoice || dch.type === ChannelType.GuildStageVoice;
    const name = sanitizeName(dch.name);

    if ([...chMap.keys()].some((k) => k.toLowerCase() === name)) {
      console.log(`  [Stoat] Skipping #${name} (already exists)`);
      chMap.set(dch.id, chMap.get(name));
      continue;
    }

    const payload = {
      type: isVoice ? "Voice" : "Text",
      name,
      description: dch.topic || null,
      nsfw: dch.nsfw || null,
    };
    if (isVoice) payload.voice = {};

    try {
      const ch = await stoatClient.api.post(`/servers/${serverId}/channels`, payload);
      chMap.set(dch.id, ch);
      const cat = dch.parentId ? catNames.get(dch.parentId) : null;
      console.log(`  [Stoat] ${isVoice ? "Voice" : "Text"} #${name}${cat ? ` [${cat}]` : ""}`);
      await wait(RATELIMIT_DELAY);
    } catch (e) {
      console.error(`  [Stoat] FAILED #${name}: ${e.message}`);
    }
  }
}

async function setCategories(serverId) {
  if (!discordCategories.length) return;
  const cats = [];

  for (const dcat of discordCategories) {
    const childIds = [];
    for (const dch of discordChannels) {
      if (dch.parentId === dcat.id && chMap.has(dch.id)) {
        childIds.push(chMap.get(dch.id)._id);
      }
    }
    if (!childIds.length) continue;
    cats.push({
      id: childIds[0],
      title: dcat.name,
      channels: childIds,
    });
  }

  if (cats.length) {
    await stoatClient.api.patch(`/servers/${serverId}`, { categories: cats });
    console.log(`\n[Stoat] Set ${cats.length} categories`);
  }
}

async function copyMessages(serverId) {
  let copied = 0;
  let failed = 0;

  for (const dch of discordChannels) {
    if (dch.type !== ChannelType.GuildText && dch.type !== ChannelType.GuildAnnouncement) continue;
    const sch = chMap.get(dch.id);
    if (!sch) continue;

    let msgs;
    try {
      msgs = [...(await dch.messages.fetch({ limit: MSG_LIMIT })).values()].reverse();
    } catch {
      continue;
    }
    if (!msgs.length) continue;

    console.log(`\n  [Msgs] #${dch.name}: ${msgs.length} msgs`);
    for (const msg of msgs) {
      const parts = [`> **${msg.author.username}** — ${msg.createdAt.toISOString()}`];
      if (msg.content) parts.push(msg.content);
      if (msg.embeds?.length) {
        for (const e of msg.embeds) {
          if (e.title) parts.push(`# ${e.title}`);
          if (e.description) parts.push(e.description);
          if (e.url) parts.push(e.url);
        }
      }
      if (msg.attachments?.size) {
        for (const a of msg.attachments.values()) {
          parts.push(a.url);
        }
      }

      try {
        await stoatClient.api.post(`/channels/${sch._id}/messages`, { content: parts.join("\n") });
        copied++;
        await wait(RATELIMIT_DELAY);
      } catch (e) {
        failed++;
        if (failed <= 3) console.error(`    Failed msg: ${e.message}`);
      }
    }
  }

  console.log(`\n[Msgs] Copied ${copied}, failed ${failed}`);
}

async function copyEmojis(serverId, guild) {
  let discordEmojis;
  try {
    discordEmojis = await guild.emojis.fetch();
  } catch {
    return;
  }
  if (!discordEmojis.size) return;

  if (!stoatClient.configuration) {
    try {
      const rootRes = await fetch(stoatClient.api.baseURL + "/");
      stoatClient.configuration = await rootRes.json();
    } catch {
      console.log("\n[Emoji] Could not fetch server config, skipping");
      return;
    }
  }
  const autumnUrl = stoatClient.configuration?.features?.autumn?.url;
  if (!autumnUrl) {
    console.log("\n[Emoji] No Autumn URL available, skipping emoji copy");
    return;
  }

  let copied = 0;
  let failed = 0;
  console.log(`\n[Emoji] ${discordEmojis.size} to copy...`);
  for (const [id, emoji] of discordEmojis) {
    try {
      const res = await fetch(emoji.imageURL());
      const blob = await res.blob();
      const file = new File([blob], emoji.name + (emoji.animated ? ".gif" : ".png"), { type: blob.type });
      const uploadId = await stoatClient.uploadFile("emojis", file);
      await stoatClient.api.put(`/custom/emoji/${uploadId}`, {
        name: emoji.name,
        parent: { type: "Server", id: serverId },
        nsfw: emoji.nsfw || false,
      });
      copied++;
      console.log(`  [Emoji] :${emoji.name}:`);
      await wait(RATELIMIT_DELAY);
    } catch (e) {
      failed++;
      if (failed <= 3) console.error(`  [Emoji] FAILED :${emoji.name}: ${e.message}`);
    }
  }
  console.log(`[Emoji] Copied ${copied}, failed ${failed}`);
}

async function main() {
  console.log("=== Discord -> Stoat Migration ===\n");

  await discordClient.login(DISCORD_TOKEN);
  stoatClient.useExistingSession({ token: STOAT_TOKEN });
  stoatClient.connect();

  const guild = await fetchDiscord(DISCORD_SERVER_ID);
  const sv = EXISTING_SERVER_ID
    ? await stoatClient.api.get(`/servers/${EXISTING_SERVER_ID}`).then(r => r.server || r)
    : await createServer(guild);
  const serverId = sv._id || sv.id;
  if (!EXISTING_SERVER_ID) {
    await createChannels(serverId);
    await setCategories(serverId);
  }
  await copyEmojis(serverId, guild);
  if (COPY_MSGS) await copyMessages(serverId);

  console.log(`\n=== Done ===`);
  console.log(`Stoat server: ${sv._id}`);
  console.log(`Channels: ${chMap.size}`);

  discordClient.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
