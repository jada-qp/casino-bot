const { EmbedBuilder } = require("discord.js");

const THEME = {
  color: 0x8b5cf6,
  success: 0x22c55e,
  danger: 0xef4444,
  warn: 0xf59e0b,
  info: 0x3b82f6,
  footer: "🎲 Casino Bot • Virtual coins only",
};

function baseEmbed(interaction, color = THEME.color) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: interaction.user.username,
      iconURL: interaction.user.displayAvatarURL({ size: 128 }),
    })
    .setTimestamp()
    .setFooter({ text: THEME.footer });
}

function gameResultEmbed(interaction, opts) {
  const {
    title,
    description,
    color,
    bet,
    outcome,
    payout,
    balance,
    extraFields = [],
  } = opts;

  const e = baseEmbed(interaction, color)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: "Bet", value: `**${bet}**`, inline: true },
      { name: "Outcome", value: outcome, inline: true },
      { name: "Payout", value: payout, inline: true },
      ...extraFields
    );

  if (typeof balance === "number") {
    e.addFields({ name: "Balance", value: `💰 **${balance}** coins`, inline: false });
  }

  return e;
}

module.exports = { THEME, baseEmbed, gameResultEmbed };
