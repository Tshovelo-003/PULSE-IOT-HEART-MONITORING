const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const envFile = path.join(__dirname, '.env');
if (!fs.existsSync(envFile)) {
  fs.writeFileSync(envFile, `JWT_SECRET=${crypto.randomBytes(48).toString('hex')}\n`);
}
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
let db;

// Defaults to null so it displays "Patient" when logged out
let activePatientId = null;

function formatDateTime(timestamp) {
  if (!timestamp) return 'None yet';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return 'None yet';
  return d.toLocaleString('en-ZA', { 
    year: 'numeric', month: '2-digit', day: '2-digit', 
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false 
  });
}

async function initDB() {
  try {
    db = await mysql.createConnection({ host: 'localhost', user: 'root', password: '', multipleStatements: true });

    await db.query(`
      DROP DATABASE IF EXISTS pulsesync_db;
      CREATE DATABASE pulsesync_db;
      USE pulsesync_db;

      CREATE TABLE users (
        user_id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('doctor', 'patient') NOT NULL,
        name VARCHAR(100) NOT NULL
      );

      CREATE TABLE patients (
        patient_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        min_bpm INT DEFAULT 60,
        max_bpm INT DEFAULT 100,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );

      CREATE TABLE readings (
        reading_id INT AUTO_INCREMENT PRIMARY KEY,
        patient_id INT,
        bpm INT NOT NULL,
        status VARCHAR(20) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
      );

      CREATE TABLE alerts (
        alert_id INT AUTO_INCREMENT PRIMARY KEY,
        patient_id INT,
        bpm INT NOT NULL,
        status VARCHAR(20) NOT NULL,
        acknowledged BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
      );
    `);

    const hashDoc = await bcrypt.hash('Mukah@12', 10);
    const hashP1 = await bcrypt.hash('Tshovelo@2003', 10);
    const hashP2 = await bcrypt.hash('2019', 10);
    const hashP3 = await bcrypt.hash('2016', 10);

    await db.query(`USE pulsesync_db;`);
    await db.query(
      `INSERT INTO users (user_id, username, password, role, name) VALUES 
       (1, 'Dr Maswanganye', ?, 'doctor', 'Dr Maswanganye'),
       (2, 'Tshovelo', ?, 'patient', 'Tshovelo Mashimbyi'),
       (3, 'Nhlelo', ?, 'patient', 'Nhlelo'),
       (4, 'Engetelo', ?, 'patient', 'Engetelo');`,
      [hashDoc, hashP1, hashP2, hashP3]
    );

    await db.query(
      `INSERT INTO patients (patient_id, user_id, min_bpm, max_bpm) VALUES 
       (1, 2, 60, 100),
       (2, 3, 60, 100),
       (3, 4, 60, 100);`
    );

    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('DB setup error:', err);
  }
}

initDB();

function authenticateToken(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid session' });
    req.user = user;
    next();
  });
}

app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    let { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    username = username.trim();

    await db.query('USE pulsesync_db;');
    const [rows] = await db.query('SELECT * FROM users WHERE BINARY username = ?', [username]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid login' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid login' });

    let patientId = null;
    if (user.role === 'patient') {
      const [pRes] = await db.query('SELECT patient_id FROM patients WHERE user_id = ?', [user.user_id]);
      if (pRes.length > 0) {
        patientId = pRes[0].patient_id;
        activePatientId = patientId; 
      }
    }

    const token = jwt.sign({ userId: user.user_id, username: user.username, role: user.role, name: user.name, patientId }, JWT_SECRET, { expiresIn: '8h' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'strict' });
    res.json({ success: true, name: user.name, role: user.role });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  activePatientId = null; // Reverts name back to "Patient"
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    await db.query('USE pulsesync_db;');
    let activePatientName = 'Patient';
    if (activePatientId) {
      const [pRes] = await db.query('SELECT u.name FROM patients p JOIN users u ON p.user_id = u.user_id WHERE p.patient_id = ?', [activePatientId]);
      if (pRes.length > 0) activePatientName = pRes[0].name;
    }
    res.json({ name: req.user.name, role: req.user.role, patientId: req.user.patientId, activePatientId, activePatientName });
  } catch (err) {
    res.json({ name: req.user.name, role: req.user.role, patientId: req.user.patientId, activePatientId });
  }
});

app.get('/api/active-info', async (req, res) => {
  try {
    await db.query('USE pulsesync_db;');
    if (!activePatientId) {
      return res.json({ patient_id: null, name: 'Patient', min_bpm: 60, max_bpm: 100 });
    }
    const [pRes] = await db.query(`
      SELECT p.patient_id, u.name, p.min_bpm, p.max_bpm 
      FROM patients p JOIN users u ON p.user_id = u.user_id 
      WHERE p.patient_id = ?
    `, [activePatientId]);
    
    if (pRes.length === 0) return res.json({ patient_id: null, name: 'Patient', min_bpm: 60, max_bpm: 100 });
    res.json(pRes[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/readings', async (req, res) => {
  try {
    const { bpm, patient_id } = req.body;
    const targetPatientId = patient_id || activePatientId;
    if (!targetPatientId || bpm == null) return res.status(400).json({ error: 'Missing target patient or BPM data' });

    await db.query('USE pulsesync_db;');
    
    // Strict medical thresholds: Low (<60), Normal (60-100), High (>100)
    let status = 'Normal';
    if (bpm < 60) status = 'Low';
    else if (bpm > 100) status = 'High';

    await db.query('INSERT INTO readings (patient_id, bpm, status) VALUES (?, ?, ?)', [targetPatientId, bpm, status]);
    if (status !== 'Normal') {
      await db.query('INSERT INTO alerts (patient_id, bpm, status) VALUES (?, ?, ?)', [targetPatientId, bpm, status]);
    }
    res.json({ success: true, activePatientId: targetPatientId, status });
  } catch (err) {
    res.status(500).json({ error: 'DB write error' });
  }
});

app.get('/api/patient/me', authenticateToken, async (req, res) => {
  if (req.user.role !== 'patient') return res.status(403).json({ error: 'Access denied' });
  const pid = req.user.patientId;

  try {
    await db.query('USE pulsesync_db;');
    const [pRes] = await db.query('SELECT min_bpm, max_bpm FROM patients WHERE patient_id = ?', [pid]);
    const { min_bpm, max_bpm } = pRes[0];
    
    const [readings] = await db.query('SELECT bpm, status, timestamp FROM readings WHERE patient_id = ? ORDER BY timestamp DESC LIMIT 30', [pid]);

    let latest = null;
    if (readings.length > 0) {
      const r = readings[0];
      const diffSecs = Math.floor((Date.now() - new Date(r.timestamp).getTime()) / 1000);
      
      let explanation = `Your heart rate is within normal resting range (${r.bpm} BPM).`;
      if (r.status === 'Low') explanation = `Bradycardia alert: Your heart rate (${r.bpm} BPM) is below 60 BPM.`;
      if (r.status === 'High') explanation = `Tachycardia alert: Your heart rate (${r.bpm} BPM) exceeds 100 BPM.`;
      
      latest = { 
        bpm: r.bpm, 
        status: r.status, 
        timestamp: r.timestamp, 
        displayTime: formatDateTime(r.timestamp), 
        age: isNaN(diffSecs) ? 0 : diffSecs,
        live: !isNaN(diffSecs) && diffSecs <= 6,
        explanation,
        isActiveTarget: activePatientId === pid
      };
    }

    const formattedHistory = readings.map(r => ({
      bpm: r.bpm,
      status: r.status,
      timestamp: r.timestamp,
      displayTime: formatDateTime(r.timestamp)
    }));

    res.json({ name: req.user.name, min: min_bpm, max: max_bpm, latest, history: formattedHistory, activePatientId });
  } catch (err) {
    res.status(500).json({ error: 'DB read error' });
  }
});

app.get('/api/doctor/patients', authenticateToken, async (req, res) => {
  if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Access denied' });
  try {
    await db.query('USE pulsesync_db;');
    const [results] = await db.query(`
      SELECT p.patient_id, u.name, 
        (SELECT bpm FROM readings WHERE patient_id = p.patient_id ORDER BY timestamp DESC LIMIT 1) AS bpm,
        (SELECT status FROM readings WHERE patient_id = p.patient_id ORDER BY timestamp DESC LIMIT 1) AS status,
        (SELECT timestamp FROM readings WHERE patient_id = p.patient_id ORDER BY timestamp DESC LIMIT 1) AS timestamp
      FROM patients p JOIN users u ON p.user_id = u.user_id
    `);
    
    const formatted = results.map(row => {
      const diffSecs = row.timestamp ? Math.floor((Date.now() - new Date(row.timestamp).getTime()) / 1000) : null;
      return { 
        patient_id: row.patient_id, 
        name: row.name, 
        bpm: row.bpm, 
        status: row.status || 'No data', 
        timestamp: row.timestamp || null,
        displayTime: formatDateTime(row.timestamp),
        age: diffSecs !== null && !isNaN(diffSecs) ? diffSecs : null,
        live: diffSecs !== null && !isNaN(diffSecs) && diffSecs <= 6
      };
    });
    res.json({ patients: formatted, activePatientId });
  } catch (err) {
    res.status(500).json({ error: 'DB query error' });
  }
});

app.get('/api/doctor/patients/:id/readings', authenticateToken, async (req, res) => {
  if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Access denied' });
  try {
    const pid = req.params.id;
    await db.query('USE pulsesync_db;');
    const [pRes] = await db.query('SELECT u.name, p.min_bpm, p.max_bpm FROM patients p JOIN users u ON p.user_id = u.user_id WHERE p.patient_id = ?', [pid]);
    if (pRes.length === 0) return res.status(404).json({ error: 'Patient not found' });
    
    const [readings] = await db.query('SELECT bpm, status, timestamp FROM readings WHERE patient_id = ? ORDER BY timestamp DESC LIMIT 30', [pid]);
    const formattedHistory = readings.map(r => ({
      bpm: r.bpm,
      status: r.status,
      timestamp: r.timestamp,
      displayTime: formatDateTime(r.timestamp)
    }));
    res.json({ name: pRes[0].name, min: pRes[0].min_bpm, max: pRes[0].max_bpm, history: formattedHistory });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

app.put('/api/doctor/patients/:id/thresholds', authenticateToken, async (req, res) => {
  if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Access denied' });
  try {
    const pid = req.params.id;
    const { min, max } = req.body;
    if (min == null || max == null || min >= max) return res.status(400).json({ error: 'Invalid range values' });

    await db.query('USE pulsesync_db;');
    await db.query('UPDATE patients SET min_bpm = ?, max_bpm = ? WHERE patient_id = ?', [min, max, pid]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Threshold update error' });
  }
});

app.get('/api/doctor/alerts', authenticateToken, async (req, res) => {
  if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Access denied' });
  try {
    await db.query('USE pulsesync_db;');
    const [results] = await db.query(`
      SELECT a.alert_id AS id, u.name, a.bpm, a.status, a.created_at 
      FROM alerts a JOIN patients p ON a.patient_id = p.patient_id JOIN users u ON p.user_id = u.user_id 
      WHERE a.acknowledged = FALSE ORDER BY a.created_at DESC
    `);
    const formatted = results.map(a => ({
      ...a,
      displayTime: formatDateTime(a.created_at)
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Alerts error' });
  }
});

app.post('/api/doctor/alerts/:id/ack', authenticateToken, async (req, res) => {
  if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Access denied' });
  try {
    await db.query('USE pulsesync_db;');
    await db.query('UPDATE alerts SET acknowledged = TRUE WHERE alert_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ack error' });
  }
});

app.listen(PORT, () => { console.log(`Server running on http://localhost:${PORT}`); });