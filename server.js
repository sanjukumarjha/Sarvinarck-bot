const express = require('express');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/refresh', (req, res) => {

    // Send tiny response immediately
    res.status(200).send("OK");

    const child = spawn('node', ['bot.js'], {
        detached: true,
        stdio: 'ignore'   // 🔥 IMPORTANT FIX
    });

    child.unref();
});

app.get('/', (req, res) => {
    res.status(200).send('Bot Server is Active.');
});

app.listen(PORT, () => {
    console.log(`🚀 Web Server listening on port ${PORT}`);
});
