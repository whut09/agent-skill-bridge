import { SkillBridgeRuntime } from "../../packages/core/src/index.js";

async function main() {
  const runtime = new SkillBridgeRuntime(["./examples/skills"]);
  await runtime.init();

  const prepared = await runtime.prepare({
    messages: [{ role: "user", content: "帮我评审代码" }],
    userMessage: "帮我评审代码",
  });

  console.log(prepared.systemPatch);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
