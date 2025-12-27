require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");

const { startDashboard } = require("./dashboard");
const { THEME, baseEmbed, gameResultEmbed } = require("./embeds");
const { getUser, addBalance, setLastDaily, getEffectiveConfig } = require("./db");
const {
  clampBet,
  coinflip,
  slotsSpinWithWinChance,
  rouletteRollBiased,
  newDeck,
  handValue,
  dealBlackjackHandsBiased,
  drawCardBiased,
  rollDiceBiased,
  hiLoRound,
} = require("./games");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const DAILY_AMOUNT = parseInt(process.env.DAILY_AMOUNT || "500", 10);
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const bjSessions = new Map(); // key: `${guildId}:${userId}` => session

function sessionKey(i) {
  return `${i.guildId}:${i.user.id}`;
}

function formatCards(cards) {
  return cards.join("  ");
}

function hoursRemaining(ms) {
  return Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
}

function hasPerm(interaction, perm) {
  // interaction.memberPermissions exists in guild contexts
  return interaction.inGuild() && interaction.memberPermissions?.has(perm);
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    startDashboard();
  } catch (e) {
    console.error("Dashboard failed to start:", e);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    // -------------------------
    // SLASH COMMANDS
    // -------------------------
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;

      // /balance
      if (cmd === "balance") {
        const user = interaction.options.getUser("user") || interaction.user;
        const u = getUser(user.id);

        const e = baseEmbed(interaction, THEME.info)
          .setTitle("💰 Balance")
          .setDescription(
            user.id === interaction.user.id
              ? "Here’s your current balance:"
              : `Here’s **${user.username}**'s current balance:`
          )
          .addFields({ name: "Coins", value: `**${u.balance}**`, inline: true });

        return interaction.reply({ embeds: [e] });
      }

      // /daily
      if (cmd === "daily") {
        const u = getUser(interaction.user.id);
        const now = Date.now();
        const remaining = u.last_daily + DAILY_COOLDOWN_MS - now;

        if (remaining > 0) {
          const hrs = hoursRemaining(remaining);
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("⏳ Daily already claimed")
            .setDescription(`Come back in about **${hrs}h** to claim again.`);
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        addBalance(interaction.user.id, DAILY_AMOUNT);
        setLastDaily(interaction.user.id, now);

        const nu = getUser(interaction.user.id);
        const e = baseEmbed(interaction, THEME.success)
          .setTitle("🎁 Daily Allowance Claimed!")
          .setDescription(`You received **${DAILY_AMOUNT}** coins.`)
          .addFields({ name: "New Balance", value: `💰 **${nu.balance}**`, inline: true });

        return interaction.reply({ embeds: [e] });
      }

      // /clear
      if (cmd === "clear") {
        if (!interaction.inGuild()) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Not available here")
            .setDescription("This command can only be used in a server channel.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        if (!hasPerm(interaction, PermissionFlagsBits.ManageMessages)) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Missing permission")
            .setDescription("You need **Manage Messages** to use this.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const amount = interaction.options.getInteger("amount");
        const channel = interaction.channel;

        if (!channel || !channel.isTextBased()) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Unsupported channel")
            .setDescription("I can only clear messages in text channels.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        // bulkDelete: up to 100, and ignores messages older than 14 days when filterOld=true
        const deleted = await channel.bulkDelete(amount, true);

        const e = baseEmbed(interaction, THEME.success)
          .setTitle("🧹 Channel Cleared")
          .setDescription(
            `Deleted **${deleted.size}** message(s).\n\n` +
            "Note: Discord can’t bulk-delete messages older than **14 days**."
          );

        return interaction.editReply({ embeds: [e] });
      }

      // /nuke
      if (cmd === "nuke") {
        if (!interaction.inGuild()) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Not available here")
            .setDescription("This command can only be used in a server channel.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        if (!hasPerm(interaction, PermissionFlagsBits.ManageChannels)) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Missing permission")
            .setDescription("You need **Manage Channels** to use this.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const channel = interaction.channel;
        if (!channel || !channel.isTextBased()) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Unsupported channel")
            .setDescription("I can only nuke text channels.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        await interaction.reply({
          embeds: [
            baseEmbed(interaction, THEME.warn)
              .setTitle("💣 Nuking channel…")
              .setDescription("Cloning + deleting this channel to remove all messages."),
          ],
          ephemeral: true,
        });

        const position = channel.rawPosition;
        const parentId = channel.parentId;
        const overwrites = channel.permissionOverwrites.cache.map((o) => o);

        const cloned = await channel.clone({
          name: channel.name,
          topic: channel.topic ?? undefined,
          nsfw: channel.nsfw ?? undefined,
          parent: parentId ?? undefined,
          reason: `Channel nuked by ${interaction.user.tag}`,
        });

        await cloned.setPosition(position);

        // Re-apply overwrites (clone usually keeps them, but this ensures consistency)
        try {
          await cloned.permissionOverwrites.set(overwrites);
        } catch {}

        await cloned.send({
          embeds: [
            new (require("discord.js").EmbedBuilder)()
              .setColor(THEME.success)
              .setTitle("🧼 Channel Nuked")
              .setDescription(`This channel was nuked by <@${interaction.user.id}>.\nAll previous messages were removed.`)
              .setTimestamp(),
          ],
        });

        // Delete old channel last
        await channel.delete(`Channel nuked by ${interaction.user.tag}`);
        return;
      }

      // /coinflip
      if (cmd === "coinflip") {
        const bet = clampBet(interaction.options.getInteger("bet"));
        const choice = interaction.options.getString("choice");

        if (!bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Invalid bet")
            .setDescription("Use a positive whole number.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const u = getUser(interaction.user.id);
        if (u.balance < bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Not enough coins")
            .setDescription(`You tried to bet **${bet}**, but you only have **${u.balance}**.`);
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        // Configurable odds (NOT displayed in Discord)
        const cfg = getEffectiveConfig(interaction.user.id, "coinflip", { headsProb: 0.5 });
        const r = coinflip(choice, cfg.headsProb);

        let color, title, desc, payoutText;
        if (r.win) {
          addBalance(interaction.user.id, bet);
          color = THEME.success;
          title = "🪙 Coinflip — WIN!";
          desc = `It landed on **${r.flip}**. You guessed **${choice}**.`;
          payoutText = `+${bet}`;
        } else {
          addBalance(interaction.user.id, -bet);
          color = THEME.danger;
          title = "🪙 Coinflip — LOSE";
          desc = `It landed on **${r.flip}**. You guessed **${choice}**.`;
          payoutText = `-${bet}`;
        }

        const nu = getUser(interaction.user.id);

        const e = gameResultEmbed(interaction, {
          title,
          description: desc,
          color,
          bet,
          outcome: `🪙 **${r.flip.toUpperCase()}**`,
          payout: payoutText,
          balance: nu.balance,
        });

        return interaction.reply({ embeds: [e] });
      }

      // /slots
      if (cmd === "slots") {
        const bet = clampBet(interaction.options.getInteger("bet"));
        if (!bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Invalid bet")
            .setDescription("Use a positive whole number.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const u = getUser(interaction.user.id);
        if (u.balance < bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Not enough coins")
            .setDescription(`You tried to bet **${bet}**, but you only have **${u.balance}**.`);
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const cfg = getEffectiveConfig(interaction.user.id, "slots", { winChance: 0.28 }); // NOT displayed

        const spin = slotsSpinWithWinChance(cfg.winChance);

        // Take bet first
        addBalance(interaction.user.id, -bet);

        const winnings = Math.floor(spin.mult * bet);
        if (winnings > 0) addBalance(interaction.user.id, winnings);

        const nu = getUser(interaction.user.id);
        const net = winnings - bet;

        const win = winnings > 0;

        const e = gameResultEmbed(interaction, {
          title: win ? "🎰 Slots — WIN!" : "🎰 Slots — LOSE",
          description: `**${spin.line.join(" | ")}**`,
          color: win ? THEME.success : THEME.danger,
          bet,
          outcome: win ? `Matched! **x${spin.mult}**` : "No match",
          payout: win ? `+${net} (won ${winnings})` : `-${bet}`,
          balance: nu.balance,
        });

        return interaction.reply({ embeds: [e] });
      }

      // /roulette
      if (cmd === "roulette") {
        const bet = clampBet(interaction.options.getInteger("bet"));
        const type = interaction.options.getString("type");
        const number = interaction.options.getInteger("number");

        if (!bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Invalid bet")
            .setDescription("Use a positive whole number.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        if (type === "number" && (number === null || number === undefined)) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Missing number")
            .setDescription("If **type=number**, you must provide a number from **0–36**.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        if (type !== "number" && (number !== null && number !== undefined)) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Extra number provided")
            .setDescription("Only provide a number when **type=number**.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const u = getUser(interaction.user.id);
        if (u.balance < bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Not enough coins")
            .setDescription(`You tried to bet **${bet}**, but you only have **${u.balance}**.`);
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const cfg = getEffectiveConfig(interaction.user.id, "roulette", { playerWinChance: 0.47 }); // NOT displayed

        // Take bet
        addBalance(interaction.user.id, -bet);

        const roll = rouletteRollBiased({ type, number }, cfg.playerWinChance);

        let win = roll.win;
        let payoutMult = roll.payoutMult;

        let winnings = 0;
        if (win) {
          winnings = bet * payoutMult;
          addBalance(interaction.user.id, winnings);
        }

        const nu = getUser(interaction.user.id);
        const outcome =
          roll.n === 0 ? `**0** (green)` : `**${roll.n}** (${roll.color}, ${roll.parity})`;

        const net = win ? (winnings - bet) : -bet;

        const e = gameResultEmbed(interaction, {
          title: win ? "🎡 Roulette — WIN!" : "🎡 Roulette — LOSE",
          description: `Result: ${outcome}`,
          color: win ? THEME.success : THEME.danger,
          bet,
          outcome: `Your bet: **${type}${type === "number" ? ` (${number})` : ""}**`,
          payout: win ? `+${net} (won ${winnings})` : `${net}`,
          balance: nu.balance,
        });

        return interaction.reply({ embeds: [e] });
      }

      // /dice
      if (cmd === "dice") {
        const bet = clampBet(interaction.options.getInteger("bet"));
        const guess = interaction.options.getInteger("guess");

        if (!bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Invalid bet")
            .setDescription("Use a positive whole number.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const u = getUser(interaction.user.id);
        if (u.balance < bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Not enough coins")
            .setDescription(`You tried to bet **${bet}**, but you only have **${u.balance}**.`);
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const cfg = getEffectiveConfig(interaction.user.id, "dice", { playerWinChance: 0.18 });

        addBalance(interaction.user.id, -bet);

        const roll = rollDiceBiased(guess, cfg.playerWinChance);
        const payoutMult = 6;

        let winnings = 0;
        if (roll.win) {
          winnings = bet * payoutMult;
          addBalance(interaction.user.id, winnings);
        }

        const nu = getUser(interaction.user.id);
        const net = roll.win ? winnings - bet : -bet;

        const e = gameResultEmbed(interaction, {
          title: roll.win ? "🎲 Dice — WIN!" : "🎲 Dice — LOSE",
          description: `You guessed **${guess}**. The die shows **${roll.roll}**.`,
          color: roll.win ? THEME.success : THEME.danger,
          bet,
          outcome: roll.win ? `Exact hit! **x${payoutMult}**` : "Missed",
          payout: roll.win ? `+${net} (won ${winnings})` : `${net}`,
          balance: nu.balance,
        });

        return interaction.reply({ embeds: [e] });
      }

      // /highlow
      if (cmd === "highlow") {
        const bet = clampBet(interaction.options.getInteger("bet"));
        const guess = interaction.options.getString("guess");

        if (!bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Invalid bet")
            .setDescription("Use a positive whole number.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const u = getUser(interaction.user.id);
        if (u.balance < bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Not enough coins")
            .setDescription(`You tried to bet **${bet}**, but you only have **${u.balance}**.`);
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const cfg = getEffectiveConfig(interaction.user.id, "highlow", { playerWinChance: 0.5 });

        addBalance(interaction.user.id, -bet);

        const round = hiLoRound(guess, cfg.playerWinChance);
        let winnings = 0;
        let title = "🃏 High-Low — LOSE";
        let color = THEME.danger;
        let payoutText = `-${bet}`;
        let outcomeText = "Wrong call";

        if (round.push) {
          winnings = bet;
          addBalance(interaction.user.id, winnings);
          title = "🃏 High-Low — PUSH";
          color = THEME.info;
          payoutText = "0 (push)";
          outcomeText = "Tie";
        } else if (round.win) {
          winnings = bet * 2;
          addBalance(interaction.user.id, winnings);
          title = "🃏 High-Low — WIN!";
          color = THEME.success;
          payoutText = `+${bet} (won ${winnings})`;
          outcomeText = "Correct call";
        }

        const nu = getUser(interaction.user.id);
        const rank = (v) => {
          if (v === 14) return "A";
          if (v === 13) return "K";
          if (v === 12) return "Q";
          if (v === 11) return "J";
          return v.toString();
        };

        const e = gameResultEmbed(interaction, {
          title,
          description: `Base card: **${rank(round.base)}** → Next card: **${rank(round.next)}**`,
          color,
          bet,
          outcome: outcomeText,
          payout: payoutText,
          balance: nu.balance,
        });

        return interaction.reply({ embeds: [e] });
      }

      // /blackjack
      if (cmd === "blackjack") {
        const bet = clampBet(interaction.options.getInteger("bet"));
        if (!bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Invalid bet")
            .setDescription("Use a positive whole number.");
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const u = getUser(interaction.user.id);
        if (u.balance < bet) {
          const e = baseEmbed(interaction, THEME.warn)
            .setTitle("Not enough coins")
            .setDescription(`You tried to bet **${bet}**, but you only have **${u.balance}**.`);
          return interaction.reply({ embeds: [e], ephemeral: true });
        }

        // Deduct bet upfront
        addBalance(interaction.user.id, -bet);

        const cfg = getEffectiveConfig(interaction.user.id, "blackjack", { playerWinChance: 0.45 }); // NOT displayed

        let deck = newDeck();
        const dealt = dealBlackjackHandsBiased(deck, cfg.playerWinChance);
        deck = dealt.deck;

        const player = dealt.player;
        const dealer = dealt.dealer;

        const key = sessionKey(interaction);
        bjSessions.set(key, { bet, deck, player, dealer, done: false, playerWinChance: cfg.playerWinChance });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("bj_hit").setLabel("Hit").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("bj_stand").setLabel("Stand").setStyle(ButtonStyle.Secondary)
        );

        const e = baseEmbed(interaction, THEME.color)
          .setTitle("🃏 Blackjack")
          .setDescription("Beat the dealer without going over **21**.")
          .addFields(
            { name: `Your Hand (${handValue(player)})`, value: formatCards(player), inline: false },
            { name: "Dealer Shows", value: `${dealer[0]}  ??`, inline: false },
            { name: "Bet", value: `**${bet}** coins`, inline: true }
          );

        return interaction.reply({ embeds: [e], components: [row] });
      }

      // fallback
      const e = baseEmbed(interaction, THEME.warn)
        .setTitle("Unknown command")
        .setDescription("This command isn’t recognized.");
      return interaction.reply({ embeds: [e], ephemeral: true });
    }

    // -------------------------
    // BUTTONS (Blackjack)
    // -------------------------
    if (interaction.isButton()) {
      const key = sessionKey(interaction);
      const s = bjSessions.get(key);

      if (!s || s.done) {
        const e = baseEmbed(interaction, THEME.warn)
          .setTitle("Blackjack hand expired")
          .setDescription("That blackjack hand is no longer active.");
        return interaction.reply({ embeds: [e], ephemeral: true });
      }

      const { bet } = s;

      const finish = async (title, color, resultText, payout) => {
        s.done = true;
        bjSessions.set(key, s);

        if (payout > 0) addBalance(interaction.user.id, payout);

        const nu = getUser(interaction.user.id);
        const e = baseEmbed(interaction, color)
          .setTitle(title)
          .setDescription(resultText)
          .addFields(
            { name: `Your Hand (${handValue(s.player)})`, value: formatCards(s.player), inline: false },
            { name: `Dealer Hand (${handValue(s.dealer)})`, value: formatCards(s.dealer), inline: false },
            { name: "Balance", value: `💰 **${nu.balance}**`, inline: true }
          )
          .setFooter({ text: `Bet: ${bet} coins • Virtual coins only` });

        return interaction.update({ embeds: [e], components: [] });
      };

      if (interaction.customId === "bj_hit") {
        // player draw: slightly biased using playerWinChance (NOT shown)
        s.player.push(drawCardBiased(s.deck, s.playerWinChance, "player"));

        const pv = handValue(s.player);

        if (pv > 21) {
          return finish(
            "🃏 Blackjack — BUST",
            THEME.danger,
            `**You busted** with **${pv}**.\n❌ You lose **${bet}** coins.`,
            0
          );
        }

        const e = baseEmbed(interaction, THEME.color)
          .setTitle("🃏 Blackjack")
          .setDescription("Choose your next move:")
          .addFields(
            { name: `Your Hand (${pv})`, value: formatCards(s.player), inline: false },
            { name: "Dealer Shows", value: `${s.dealer[0]}  ??`, inline: false },
            { name: "Bet", value: `**${bet}** coins`, inline: true }
          );

        return interaction.update({ embeds: [e] });
      }

      if (interaction.customId === "bj_stand") {
        // Dealer hits to 17+, with biased draws (NOT shown)
        while (handValue(s.dealer) < 17) {
          s.dealer.push(drawCardBiased(s.deck, s.playerWinChance, "dealer"));
        }

        const pv = handValue(s.player);
        const dv = handValue(s.dealer);

        if (dv > 21 || pv > dv) {
          return finish(
            "🃏 Blackjack — WIN!",
            THEME.success,
            `✅ You win! (**${pv}** vs **${dv}**)\nYou receive **${bet * 2}** back (profit **${bet}**).`,
            bet * 2
          );
        }

        if (pv === dv) {
          return finish(
            "🃏 Blackjack — PUSH",
            THEME.info,
            `🤝 Push! (**${pv}** vs **${dv}**)\nYou get your bet back (**${bet}**).`,
            bet
          );
        }

        return finish(
          "🃏 Blackjack — LOSE",
          THEME.danger,
          `❌ Dealer wins. (**${pv}** vs **${dv}**)\nYou lose **${bet}** coins.`,
          0
        );
      }

      const e = baseEmbed(interaction, THEME.warn)
        .setTitle("Unknown action")
        .setDescription("That button isn’t recognized.");
      return interaction.reply({ embeds: [e], ephemeral: true });
    }
  } catch (e) {
    console.error(e);

    if (interaction.isRepliable()) {
      try {
        const errEmbed = baseEmbed(interaction, THEME.danger)
          .setTitle("Something went wrong")
          .setDescription("Check the console for details.");
        await interaction.reply({ embeds: [errEmbed], ephemeral: true });
      } catch {}
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
