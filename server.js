require('dotenv').config();

const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database connection with Aiven SSL
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'mysql-3b509606-snothitshovelo-4576.d.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD || 'AVNS_fERnQPwQjYM456TA7jc',
    database: process.env.DB_NAME || 'defaultdb',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 17525,
    ssl: { rejectUnauthorized: false }
});

db.connect(err => {
    if (err) console.error('Database connection error:', err);
    else console.log('Connected successfully to Aiven Cloud MySQL Database.');
});

// In-memory store for latest live telemetry sync
let latestTelemetry = { patient_id: 3, name: 'Engetelo', bpm: 107, status: 'High', last_reading: new Date().toISOString() };

// 1. Strict Role-Based Login & Registration Endpoint
app.post('/api/login', (req, res) => {
    const { username, password, role } = req.body;

    if (role === 'doctor') {
        if (username.trim().toLowerCase() === 'dr maswanganye') {
            return res.json({ success: true, username: 'Dr Maswanganye', role: 'doctor' });
        }
        return res.status(401).json({ error: 'Access denied. Only Dr Maswanganye is authorized as Doctor.' });
    } else if (role === 'patient') {
        if (!username || username.trim() === '') {
            return res.status(400).json({ error: 'Patient name is required.' });
        }
        return res.json({ success: true, username: username, role: 'patient', patient_id: 3 });
    }
    res.status(400).json({ error: 'Invalid role selection.' });
});

// 2. Arduino Status Endpoint (Syncs active patient name to LCD)
app.get('/api/arduino/status', (req, res) => {
    res.json({ active_patient: latestTelemetry.name, patient_id: latestTelemetry.patient_id });
});

// 3. Doctor Patient Directory
app.get('/api/doctor/patients', (req, res) => {
    res.json([
        { id: 1, name: 'Tshovelo Mashimbyi', latest: 107, status: 'High', last_updated: '2026/10/28 01:00:12' },
        { id: 2, name: 'Nhlelo', latest: 88, status: 'Normal', last_updated: '2026/10/28 00:59:45' },
        { id: 3, name: latestTelemetry.name, latest: latestTelemetry.bpm, status: latestTelemetry.status, last_updated: latestTelemetry.last_reading }
    ]);
});

// 4. Individual Patient Detailed History & Reports for Doctor Inspection
app.get('/api/doctor/patient/:id/history', (req, res) => {
    const patientId = req.params.id;
    res.json({
        patient_id: patientId,
        history: [
            { date: '2026/10/28', time: '00:45:00', bpm: 82, status: 'Normal' },
            { date: '2026/10/28', time: '00:50:00', bpm: 95, status: 'Normal' },
            { date: '2026/10/28', time: '00:55:00', bpm: latestTelemetry.bpm, status: latestTelemetry.status }
        ],
        alerts: [
            { message: `Threshold alert: Heart rate (${latestTelemetry.bpm} BPM) recorded with status ${latestTelemetry.status}.`, timestamp: latestTelemetry.last_reading }
        ]
    });
});

// 5. IoT Hardware Telemetry Receiver (Arduino / Sensor Node)
app.post('/api/telemetry', (req, res) => {
    const deviceKey = req.headers['x-device-key'];
    if (deviceKey !== process.env.DEVICE_KEY && deviceKey !== 'f5e2c78101a84a75ffbac169ca8a6ebd') {
        return res.status(403).json({ error: 'Invalid device key' });
    }
    const { patient_id, bpm, raw_signal } = req.body;
    
    let status = 'Normal';
    if (bpm > 100) status = 'High';
    else if (bpm < 60) status = 'Low';

    latestTelemetry = {
        patient_id: patient_id || 3,
        name: 'Engetelo',
        bpm: bpm,
        status: status,
        last_reading: new Date().toLocaleString()
    };

    console.log(`Telemetry synchronized - Patient: Engetelo, BPM: ${bpm}, Status: ${status}`);
    res.json({ success: true, message: 'Telemetry synchronized successfully' });
});

// 6. Patient Live Feed Endpoint
app.get('/api/patient/live/:id', (req, res) => {
    res.json({
        patient_id: req.params.id,
        bpm: latestTelemetry.bpm,
        status: latestTelemetry.status,
        last_reading: latestTelemetry.last_reading,
        trend: [75, 82, 88, 95, latestTelemetry.bpm]
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));