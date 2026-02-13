const express = require('express');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/refresh', (req, res) => {
    // 1. Send the tiniest possible response IMMEDIATELY
    res.status(200).json({ status: "Spawned detached bot" });

    // 2. Launch the bot completely outside of the Express event loop
    // 2. Launch the bot completely outside of the Express event loop
    const child = spawn('node', ['bot.js'], {
        detached: true,     
        stdio: 'inherit'    // ✨ CHANGED: This brings your logs back to Render!
    });

    // 3. Sever the tie so the server doesn't wait for the bot to finish
    child.unref(); 
});

app.get('/', (req, res) => {
    res.status(200).send('Bot Server is Active. Use /refresh to trigger.');
});

app.listen(PORT, () => {
    console.log(`🚀 Web Server listening on port ${PORT}`);
});

