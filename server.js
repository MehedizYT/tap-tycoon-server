// server.js

const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors()); // Allow requests from any origin (your game)
app.use(express.json()); // Allow the server to read JSON from requests

// --- In-Memory Database ---
const referralsDB = {};

// --- API Endpoints ---
app.post('/referral', (req, res) => {
  const { referrerId, refereeId } = req.body;
  if (!referrerId || !refereeId) {
    return res.status(400).send('Missing referrerId or refereeId');
  }
  if (!referralsDB[referrerId]) {
    referralsDB[referrerId] = { rewardsToClaim: 0, referrals: [] };
  }
  if (referralsDB[referrerId].referrals.includes(refereeId)) {
    return res.status(200).send('Referral already recorded.');
  }
  referralsDB[referrerId].rewardsToClaim += 1;
  referralsDB[referrerId].referrals.push(refereeId);
  console.log(`Referral recorded: ${referrerId} referred ${refereeId}`);
  console.log('Current DB state:', referralsDB);
  res.status(200).send('Referral recorded successfully');
});

app.get('/rewards/:userId', (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).send('Missing userId');
  }
  const userData = referralsDB[userId];
  if (!userData) {
    return res.json({ rewardsToClaim: 0, referrals: [] });
  }
  res.json(userData);
});

app.post('/claim', (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).send('Missing userId');
  }
  const userData = referralsDB[userId];
  if (!userData || userData.rewardsToClaim === 0) {
    return res.status(400).send('No rewards to claim');
  }
  userData.rewardsToClaim = 0;
  console.log(`Rewards claimed for user: ${userId}`);
  console.log('Current DB state:', referralsDB);
  res.status(200).send('Rewards claimed successfully');
});

// Start the server
const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port);
});