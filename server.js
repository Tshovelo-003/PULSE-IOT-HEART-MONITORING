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

// Patient storage mapping for all 3 patients
let patientsData = {
    1: { id: 1, name: 'Tshovelo Mashimbyi', bpm: 0, status: 'No data', last_reading: 'None yet', trend: [] },
    2: { id: 2, name: 'Nhlelo', bpm: 0, status: 'No data', last_reading: 'None yet', trend: [] },
    3: { id: 3, name: 'Engetelo', bpm: 0, status: 'No data', last_reading: 'None yet', trend: [] }
};

let activeTargetPatientId = 3; // Default targeted hardware feed

// 1. Strict Role Authorization Endpoint
app.post('/api/login', (req, res) => {
    const { username, password, role } = req.body;
    const cleanUser = username ? username.trim() : '';

    if (role === 'doctor') {
        if (cleanUser.toLowerCase() === 'dr maswanganye') {
            return res.json({ success: true, username: 'Dr Maswanganye', role: 'doctor' });
        }
        return res.status(401).json({ error: 'Unauthorized: Only Dr Maswanganye is authorized as Doctor.' });
    } else if (role === 'patient') {
        // Enforce that doctors cannot sign in as patients
        if (cleanUser.toLowerCase().includes('dr') || cleanUser.toLowerCase() === 'dr maswanganye') {
            return res.status(403).json({ error: 'Access Denied: Doctors cannot log into patient dashboards.' });
        }
        if (!cleanUser) {
            return res.status(400).json({ error: 'Patient name is required.' });
        }
        // Match or assign patient ID
        let pId = 1;
        if (cleanUser.toLowerCase().includes('nhlelo')) pId = 2;
        else if (cleanUser.toLowerCase().includes('engetelo')) pId = 3;

        return res.json({ success: true, username: cleanUser, role: 'patient', patient_id: pId });
    }
    res.status(400).json({ error: 'Invalid role selection.' });
});

// 2. Target Hardware Feed Control (Doctor Directory selection)
app.post('/api/doctor/set-target', (req, res) => {
    const { patient_id } = req.body;
    if (patientsData[patient_id]) {
        activeTargetPatientId = parseInt(patient_id);
        return res.json({ success: true, active_target: patientsData[activeTargetPatientId].name });
    }
    res.status(400).json({ error: 'Invalid patient ID' });
});

app.get('/api/arduino/status', (req, res) => {
    const target = patientsData[activeTargetPatientId];
    res.json({ patient_id: target.id, name: target.name });
});

// 3. Doctor Patient Directory
app.get('/api/doctor/patients', (req, res) => {
    let resultList = Object.values(patientsData).map(p => ({
        id: p.id,
        name: p.name,
        latest: p.bpm > 0 ? p.bpm : '--',
        status: p.status,
        signal: p.last_reading,
        is_active_target: p.id === activeTargetPatientId
    }));
    res.json(resultList);
});

// 4. Individual Patient History & Reports
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

// 5. MAX30102 Telemetry Receiver from Arduino
app.post('/api/telemetry', (req, res) => {
    const deviceKey = req.headers['x-device-key'];
    if (deviceKey !== process.env.DEVICE_KEY && deviceKey !== 'f5e2c78101a84a75ffbac169ca8a6ebd') {
        return res.status(403).json({ error: 'Invalid device key' });
    }
    const { patient_id, bpm, raw_signal } = req.body;
    const targetId = patient_id || activeTargetPatientId;

    if (patientsData[targetId]) {
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

// 6. Patient Live Feed Endpoint
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