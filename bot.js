const { runBot } = require('./bot-core');

(async () => {
    try {
        console.log("🚀 Bot execution started...");
        await runBot();
        console.log("✅ Bot execution completed successfully.");
    } catch (error) {
        console.error("❌ Fatal Bot Error:", error);
        process.exit(1); // Fail workflow if something breaks
    }
})();
