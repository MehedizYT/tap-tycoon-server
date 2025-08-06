// This is the full server code for index.js

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const BOT_TOKEN = process.env.BOT_TOKEN; // Loaded from Render's Environment Variables
const PORT = process.env.PORT || 3000;
const DB_FILE = './referrals.db';
const REFERRER_REWARD = { money: 50000, gems: 5 };

if (!BOT_TOKEN) {
    console.error("FATAL ERROR: BOT_TOKEN is not defined. Please set it in your environment variables.");
    process.exit(1);
}

const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) { console.error('DATABASE ERROR:', err.message); }
    else {
        console.log('✅ Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS referrals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id INTEGER NOT NULL,
            referred_id INTEGER NOT NULL UNIQUE,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.on('polling_error', (error) => console.error(`🚨 POLLING ERROR: ${error.code}`));
console.log('🤖 Telegram Bot is polling for messages...');

bot.onText(/\/start (.+)/, (msg, match) => {
    const referredId = msg.from.id;
    const referrerId = match[1];
    if (String(referredId) === String(referrerId)) return;
    
    console.log(`➡️ Referral attempt: ${referrerId} -> ${referredId}`);
    const sql = `INSERT OR IGNORE INTO referrals (referrer_id, referred_id) VALUES (?, ?)`;
    db.run(sql, [referrerId, referredId], function(err) {
        if (err) { console.error("🚨 DATABASE INSERT ERROR:", err.message); }
        else if (this.changes > 0) {
            console.log(`✅ New referral recorded.`);
            bot.sendMessage(referredId, "Welcome! Thanks to a friend, you'll get a special bonus!");
        }
    });
});

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('Tap Tycoon API Server is online.'));

app.get('/my-referrals/:userId', (req, res) => {
    const userId = req.params.userId;
    console.log(`➡️ Request for stats for user: ${userId}`);
    const sql = `SELECT status FROM referrals WHERE referrer_id = ?`;
    db.all(sql, [userId], (err, rows) => {
        if (err) {
            console.error(`🚨 DB QUERY ERROR for user ${userId}:`, err.message);
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
    console.log(`➡️ Request to claim rewards for user: ${userId}`);
    const sql = `UPDATE referrals SET status = 'claimed' WHERE referrer_id = ? AND status = 'pending'`;
    db.run(sql, [userId], function(err) {
        if (err) {
            console.error(`🚨 DB UPDATE ERROR for user ${userId}:`, err.message);
            return res.status(500).json({ error: 'Database update failed' });
        }
        res.status(200).json({
            claimedCount: this.changes,
            rewards: { money: this.changes * REFERRER_REWARD.money, gems: this.changes * REFERRER_REWARD.gems }
        });
    });
});

app.listen(PORT, () => console.log(`🚀 API Server is listening on port ${PORT}`));
