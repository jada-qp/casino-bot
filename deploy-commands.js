require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder().setName("daily").setDescription("Claim your daily allowance."),
  new SlashCommandBuilder().setName("balance").setDescription("Check balance.")
    .addUserOption(o => o.setName("user").setDescription("User to check").setRequired(false)),

  new SlashCommandBuilder().setName("coinflip").setDescription("Bet on a coinflip.")
    .addIntegerOption(o => o.setName("bet").setDescription("Bet amount").setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName("choice").setDescription("heads or tails").setRequired(true)
      .addChoices({ name: "heads", value: "heads" }, { name: "tails", value: "tails" })),

  new SlashCommandBuilder().setName("slots").setDescription("Spin the slots.")
    .addIntegerOption(o => o.setName("bet").setDescription("Bet amount").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName("roulette").setDescription("Roulette: red/black/even/odd/number.")
    .addIntegerOption(o => o.setName("bet").setDescription("Bet amount").setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName("type").setDescription("Bet type").setRequired(true)
      .addChoices(
        { name: "red", value: "red" },
        { name: "black", value: "black" },
        { name: "even", value: "even" },
        { name: "odd", value: "odd" },
        { name: "number", value: "number" },
      ))
    .addIntegerOption(o => o.setName("number").setDescription("0-36 (only if type=number)").setRequired(false).setMinValue(0).setMaxValue(36)),

  new SlashCommandBuilder().setName("dice").setDescription("Roll a die and guess the exact number.")
    .addIntegerOption(o => o.setName("bet").setDescription("Bet amount").setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName("guess").setDescription("Pick a number from 1-6").setRequired(true).setMinValue(1).setMaxValue(6)),

  new SlashCommandBuilder().setName("highlow").setDescription("Guess whether the next card is higher or lower.")
    .addIntegerOption(o => o.setName("bet").setDescription("Bet amount").setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName("guess").setDescription("Higher or lower").setRequired(true)
      .addChoices(
        { name: "higher", value: "higher" },
        { name: "lower", value: "lower" },
      )),

  new SlashCommandBuilder().setName("blackjack").setDescription("Play blackjack vs dealer (buttons).")
    .addIntegerOption(o => o.setName("bet").setDescription("Bet amount").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName("clear").setDescription("Clear the last N messages (max 100; <14 days old).")
    .addIntegerOption(o => o.setName("amount").setDescription("How many messages to delete").setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder().setName("nuke").setDescription("Clone + delete this channel to wipe all messages."),

  new SlashCommandBuilder().setName("dashboard").setDescription("Get the admin dashboard link (admin only)."),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const clientId = process.env.CLIENT_ID;
    const guildId = process.env.GUILD_ID;

    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log("✅ Commands deployed to guild.");
  } catch (err) {
    console.error(err);
  }
})();
