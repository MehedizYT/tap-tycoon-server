// --- DEPENDENCIES ---
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { Pool } = require('pg'); // Changed from sqlite3 to pg's Pool
const cors = require('cors');

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL; // From Render Environment Variables
const PORT = process.env.PORT || 3000;
const REFERRER_REWARD = { money: 50000, gems: 5 };

// --- VALIDATION ---
if (!BOT_TOKEN) {
    console.error("FATAL ERROR: BOT_TOKEN is not defined.");
    process.exit(1);
}
if (!DATABASE_URL) {
    console.error("FATAL ERROR: DATABASE_URL is not defined. Please set it in your Render environment variables.");
    process.exit(1);
}

// --- DATABASE INITIALIZATION ---
// Create a new Pool instance to connect to the PostgreSQL database
const pool = new Pool({
    connectionString: DATABASE_URL,
    // Required for Render's PostgreSQL connections
    ssl: {
        rejectUnauthorized: false
    }
});

// Function to create the table if it doesn't exist
const initializeDatabase = async () => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS referrals (
            id SERIAL PRIMARY KEY,
            referrer_id BIGINT NOT NULL,
            referred_id BIGINT NOT NULL UNIQUE,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pool.query(createTableQuery);
        console.log('✅ Database initialized and referrals table is ready.');
    } catch (err) {
        console.error('🚨 DATABASE INITIALIZATION ERROR:', err.stack);
        process.exit(1); // Exit if we can't even create the table
    }
};

// --- TELEGRAM BOT LOGIC ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.on('polling_error', (error) => console.error(`🚨 POLLING ERROR: ${error.code} - ${error.message}`));
console.log('🤖 Telegram Bot is polling for messages...');

bot.onText(/\/start (.+)/, async (msg, match) => {
    const referredId = msg.from.id;
    const referrerId = match[1];

    // Prevent users from referring themselves
    if (String(referredId) === String(referrerId)) return;

    console.log(`➡️ Referral attempt: ${referrerId} -> ${referredId}`);
    
    // Use PostgreSQL's parameterized query syntax ($1, $2, etc.)
    const sql = `INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2) ON CONFLICT (referred_id) DO NOTHING`;
    
    try {
        const result = await pool.query(sql, [referrerId, referredId]);
        // If a row was inserted, rowCount will be 1
        if (result.rowCount > 0) {
            console.log(`✅ New referral recorded: ${referrerId} -> ${referredId}`);
            bot.sendMessage(referredId, "Welcome! Thanks for being referred by a friend, you'll get a special starting bonus in the game!");
        } else {
            console.log(`-  Existing user started with referral link: ${referredId}`);
        }
    } catch (err) {
        console.error("🚨 DATABASE INSERT ERROR:", err.message);
    }
});

// Default start command without a referral code
bot.onText(/\/start$/, (msg) => {
    bot.sendMessage(msg.chat.id, "Welcome to Tap Tycoon! Open the game below to start playing.");
});


// --- API SERVER (EXPRESS) ---
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('Tap Tycoon API Server is online.'));

// Refactored to use async/await for cleaner code
app.get('/my-referrals/:userId', async (req, res) => {
    const { userId } = req.params;
    console.log(`➡️ Request for stats for user: ${userId}`);
    const sql = `SELECT status FROM referrals WHERE referrer_id = $1`;
    try {
        const { rows } = await pool.query(sql, [userId]);
        const unclaimedCount = rows.filter(r => r.status === 'pending').length;
        res.json({
            friendsInvited: rows.length,
            unclaimedCount: unclaimedCount,
            unclaimedReward: { money: unclaimedCount * REFERRER_REWARD.money, gems: unclaimedCount * REFERRER_REWARD.gems }
        });
    } catch (err) {
        console.error(`🚨 DB QUERY ERROR for user ${userId}:`, err.message);
        res.status(500).json({ error: 'Database query failed' });
    }
});

// Refactored to use async/await
app.post('/claim-rewards', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    console.log(`➡️ Request to claim rewards for user: ${userId}`);
    const sql = `UPDATE referrals SET status = 'claimed' WHERE referrer_id = $1 AND status = 'pending'`;
    try {
        const result = await pool.query(sql, [userId]);
        // result.rowCount contains the number of updated rows
        res.status(200).json({
            claimedCount: result.rowCount,
            rewards: { money: result.rowCount * REFERRER_REWARD.money, gems: result.rowCount * REFERRER_REWARD.gems }
        });
    } catch (err) {
        console.error(`🚨 DB UPDATE ERROR for user ${userId}:`, err.message);
        res.status(500).json({ error: 'Database update failed' });
    }
});

// --- SERVER START ---
// Start the server only after the database is confirmed to be ready
app.listen(PORT, async () => {
    await initializeDatabase();
    console.log(`🚀 API Server is listening on port ${PORT}`);
});    });
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
