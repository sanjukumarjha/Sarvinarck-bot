const { runBot } = require('./bot-core');

(async () => {
    try {
        console.log("🟢 Detached process started.");
        await runBot();
    } catch (error) {
        console.error("❌ Fatal Detached Bot Error:", error);
    } finally {
        console.log("🛑 Detached process shutting down to free memory.");
        // THIS IS MANDATORY. It prevents zombie processes on Render.
        process.exit(0); 
    }
})();
