require('dotenv').config();

const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// Patient storage mapping
let patientsData = {
    1: { id: 1, name: 'Tshovelo Mashimbyi', bpm: 0, status: 'No data', last_reading: 'None yet', trend: [] },
    2: { id: 2, name: 'Nhlelo', bpm: 0, status: 'No data', last_reading: 'None yet', trend: [] },
    3: { id: 3, name: 'Engetelo', bpm: 0, status: 'No data', last_reading: 'None yet', trend: [] }
};

// Active session state for Arduino LCD sync
let activeSession = { patient_id: 0, name: 'Waiting...' };

// 1. Strict Role Authorization Endpoint
app.post('/api/login', (req, res) => {
    const { username, password, role } = req.body;
    const cleanUser = username ? username.trim() : '';

    if (role === 'doctor') {
        if (cleanUser.toLowerCase() === 'dr maswanganye') {
            activeSession = { patient_id: 0, name: 'Dr Maswanganye' };
            return res.json({ success: true, username: 'Dr Maswanganye', role: 'doctor' });
        }
        return res.status(401).json({ error: 'Unauthorized: Only Dr Maswanganye is authorized as Doctor.' });
    } else if (role === 'patient') {
        if (cleanUser.toLowerCase().includes('dr') || cleanUser.toLowerCase() === 'dr maswanganye') {
            return res.status(403).json({ error: 'Access Denied: Doctors cannot log into patient dashboards.' });
        }
        if (!cleanUser) {
            return res.status(400).json({ error: 'Patient name is required.' });
        }

        let pId = 1;
        if (cleanUser.toLowerCase().includes('nhlelo')) pId = 2;
        else if (cleanUser.toLowerCase().includes('engetelo')) pId = 3;
        else {
            // Register or map custom patient name dynamically
            patientsData[pId] = { id: pId, name: cleanUser, bpm: 0, status: 'No data', last_reading: 'None yet', trend: [] };
        }

        activeSession = { patient_id: pId, name: cleanUser };
        return res.json({ success: true, username: cleanUser, role: 'patient', patient_id: pId });
    }
    res.status(400).json({ error: 'Invalid role selection.' });
});

// Logout endpoint to reset Arduino LCD to "Waiting for patient..."
app.post('/api/logout', (req, res) => {
    activeSession = { patient_id: 0, name: 'Waiting...' };
    res.json({ success: true });
});

app.get('/api/arduino/status', (req, res) => {
    res.json(activeSession);
});

// 2. Doctor Patient Directory (Cleaned without hardware control buttons)
app.get('/api/doctor/patients', (req, res) => {
    let resultList = Object.values(patientsData).map(p => ({
        id: p.id,
        name: p.name,
        latest: p.bpm > 0 ? `${p.bpm} BPM` : '--',
        status: p.status,
        signal: p.last_reading
    }));
    res.json(resultList);
});

// 3. Individual Patient History & Reports
app.get('/api/doctor/patient/:id/history', (req, res) => {
    const pId = req.params.id;
    const p = patientsData[pId] || patientsData[1];
    res.json({
        patient_id: p.id,
        history: p.trend.map((val, idx) => ({
            date: new Date().toLocaleDateString(),
            time: `00:${10 + idx}:00`,
            bpm: val,
            status: val > 100 ? 'High' : (val < 60 ? 'Low' : 'Normal')
        })),
        alerts: p.bpm > 100 ? [{ message: `Tachycardia alert: Heart rate (${p.bpm} BPM) exceeds threshold (100 BPM).`, timestamp: p.last_reading }] : []
    });
});

// 4. MAX30102 Telemetry Receiver from Arduino
app.post('/api/telemetry', (req, res) => {
    const deviceKey = req.headers['x-device-key'];
    if (deviceKey !== process.env.DEVICE_KEY && deviceKey !== 'f5e2c78101a84a75ffbac169ca8a6ebd') {
        return res.status(403).json({ error: 'Invalid device key' });
    }
    const { patient_id, bpm, raw_signal } = req.body;
    const targetId = patient_id || activeSession.patient_id;

    if (patientsData[targetId] && bpm > 0) {
        let status = 'Normal';
        if (bpm > 100) status = 'High';
        else if (bpm < 60) status = 'Low';

        patientsData[targetId].bpm = bpm;
        patientsData[targetId].status = status;
        patientsData[targetId].last_reading = new Date().toLocaleString();
        
        patientsData[targetId].trend.push(bpm);
        if (patientsData[targetId].trend.length > 15) patientsData[targetId].trend.shift();
    }

    res.json({ success: true, message: 'Sensor data recorded' });
});

// 5. Patient Live Feed Endpoint
app.get('/api/patient/live/:id', (req, res) => {
    const pId = req.params.id;
    const p = patientsData[pId] || patientsData[3];
    res.json({
        patient_id: p.id,
        name: p.name,
        bpm: p.bpm > 0 ? p.bpm : '--',
        status: p.status,
        last_reading: p.last_reading,
        trend: p.trend
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));