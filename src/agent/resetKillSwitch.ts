// Usage: npm run agent:reset-kill-switch -- PAPER
//
// The kill switch is deliberately never auto-cleared, even for trips the
// system caused itself (e.g. hitting the daily loss cap) - the design
// doc's "trip for the rest of the day" is about *effect* (no more
// trades today), not about silently resuming tomorrow without a human
// looking at why it tripped. This is the only way to clear it.

import { prisma } from "@/lib/prisma";

async function main() {
  const mode = process.argv[2];
  if (!mode) {
    console.error("Usage: npm run agent:reset-kill-switch -- <PAPER|TESTNET|LIVE>");
    process.exitCode = 1;
    return;
  }

  const state = await prisma.agentState.findUnique({ where: { id: mode } });
  if (!state) {
    console.log(`No AgentState row for "${mode}" yet - nothing to reset.`);
    return;
  }

  if (!state.killSwitchActive) {
    console.log(`Kill switch for "${mode}" is not active.`);
    return;
  }

  console.log(`Clearing kill switch for "${mode}" (was: ${state.killSwitchReason ?? "unknown reason"})`);
  await prisma.agentState.update({
    where: { id: mode },
    data: { killSwitchActive: false, killSwitchReason: null },
  });
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
