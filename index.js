// This is the full server code for index.js

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const BOT_TOKEN = process.env.BOT_TOKEN; // Loaded from Render's Environment Variables
const PORT = process.env.PORT || 3000;
const DB_FILE = './data/game_data.db'; // Store DB in a dedicated data directory
const REFERRER_REWARD = { money: 50000, gems: 5 };

if (!BOT_TOKEN) {
    console.error("FATAL ERROR: BOT_TOKEN is not defined. Please set it in your environment variables.");
    process.exit(1);
}

// Ensure the data directory exists
const fs = require('fs');
const path = require('path');
const dbDir = path.dirname(DB_FILE);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir);
}

const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('DATABASE ERROR:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Connected to the SQLite database.');
        db.serialize(() => {
            // Table for referral tracking
            db.run(`CREATE TABLE IF NOT EXISTS referrals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                referrer_id TEXT NOT NULL,
                referred_id TEXT NOT NULL UNIQUE,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);

            // Table for saving the entire game state for each user
            db.run(`CREATE TABLE IF NOT EXISTS user_saves (
                user_id TEXT PRIMARY KEY NOT NULL,
                game_state TEXT NOT NULL,
                last_saved TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);
            console.log('✅ Database tables initialized.');
        });
    }
});

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.on('polling_error', (error) => console.error(`🚨 POLLING ERROR: ${error.code} - ${error.message}`));
console.log('🤖 Telegram Bot is polling for messages...');

bot.onText(/\/start (.+)/, (msg, match) => {
    const referredId = String(msg.from.id);
    const referrerId = String(match[1]);

    // A user cannot refer themselves
    if (referredId === referrerId) return;

    console.log(`➡️ Referral attempt: ${referrerId} -> ${referredId}`);
    const sql = `INSERT OR IGNORE INTO referrals (referrer_id, referred_id) VALUES (?, ?)`;
    db.run(sql, [referrerId, referredId], function(err) {
        if (err) {
            console.error("🚨 DATABASE INSERT ERROR:", err.message);
        } else if (this.changes > 0) {
            console.log(`✅ New referral recorded for ${referredId} by ${referrerId}.`);
            // You can optionally notify the referred user
            // bot.sendMessage(referredId, "Welcome! Thanks to a friend, you'll get a special bonus in the game!");
        } else {
            console.log(`❕ Referral already exists for ${referredId}.`);
        }
    });
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '500kb' })); // Use express.json and set a size limit

app.get('/', (req, res) => res.send('Tap Tycoon API Server is online.'));

// --- START: NEW SAVE/LOAD LOGIC ---

// Endpoint to LOAD a user's saved game
app.get('/load/:userId', (req, res) => {
    const userId = req.params.userId;
    if (!userId) return res.status(400).json({ error: 'User ID is required.' });

    console.log(`➡️ [LOAD] Request for save data for user: ${userId}`);
    const sql = `SELECT game_state FROM user_saves WHERE user_id = ?`;

    db.get(sql, [userId], (err, row) => {
        if (err) {
            console.error(`🚨 [LOAD] DB QUERY ERROR for user ${userId}:`, err.message);
            return res.status(500).json({ error: 'Database query failed' });
        }
        if (row && row.game_state) {
            console.log(`✅ [LOAD] Found save data for user: ${userId}`);
            res.status(200).json(JSON.parse(row.game_state));
        } else {
            console.log(`❕ [LOAD] No save data found for new user: ${userId}`);
            // 404 is the correct status code for "Not Found"
            res.status(404).json({ message: 'No save data found for this user.' });
        }
    });
});

// Endpoint to SAVE a user's game state
app.post('/save', (req, res) => {
    const { userId, gameState } = req.body;
    if (!userId || !gameState) {
        return res.status(400).json({ error: 'userId and gameState are required.' });
    }

    console.log(`➡️ [SAVE] Request to save data for user: ${userId}`);
    // The 'INSERT OR REPLACE' command is an "UPSERT" operation:
    // It will INSERT a new row if user_id doesn't exist,
    // or REPLACE the existing row if user_id already exists.
    const sql = `INSERT OR REPLACE INTO user_saves (user_id, game_state, last_saved) VALUES (?, ?, CURRENT_TIMESTAMP)`;
    
    // We store the gameState object as a JSON string
    const gameStateJson = JSON.stringify(gameState);

    db.run(sql, [userId, gameStateJson], function(err) {
        if (err) {
            console.error(`🚨 [SAVE] DB UPDATE ERROR for user ${userId}:`, err.message);
            return res.status(500).json({ error: 'Failed to save game data.' });
        }
        console.log(`✅ [SAVE] Successfully saved data for user: ${userId}`);
        res.status(200).json({ success: true, message: 'Game saved successfully.' });
    });
});

// --- END: NEW SAVE/LOAD LOGIC ---


app.get('/my-referrals/:userId', (req, res) => {
    const userId = req.params.userId;
    console.log(`➡️ [REFERRAL] Request for stats for user: ${userId}`);
    const sql = `SELECT status FROM referrals WHERE referrer_id = ?`;
    db.all(sql, [userId], (err, rows) => {
        if (err) {
            console.error(`🚨 [REFERRAL] DB QUERY ERROR for user ${userId}:`, err.message);
            return res.status(500).json({ error: 'Database query failed' });
        }
        const unclaimedCount = rows.filter(r => r.status === 'pending').length;
        res.json({
            friendsInvited: rows.length,
            unclaimedCount: unclaimedCount,
            unclaimedReward: { money: unclaimedCount * REFERRER_REWARD.money, gems: unclaimedCount * REFERRER_REWARD.gems }
        });
    });
});

app.post('/claim-rewards', (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    console.log(`➡️ [CLAIM] Request to claim rewards for user: ${userId}`);
    const sql = `UPDATE referrals SET status = 'claimed' WHERE referrer_id = ? AND status = 'pending'`;
    db.run(sql, [userId], function(err) {
        if (err) {
            console.error(`🚨 [CLAIM] DB UPDATE ERROR for user ${userId}:`, err.message);
            return res.status(500).json({ error: 'Database update failed' });
        }
        console.log(`✅ [CLAIM] User ${userId} claimed ${this.changes} reward(s).`);
        res.status(200).json({
            claimedCount: this.changes,
            rewards: { money: this.changes * REFERRER_REWARD.money, gems: this.changes * REFERRER_REWARD.gems }
        });
    });
});

app.listen(PORT, () => console.log(`🚀 API Server is listening on port ${PORT}`));
