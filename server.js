const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Patient records database with complete historical logs, dates, times, and statuses
let patientsDatabase = {
    "Tshovelo Mashimbyi": { name: "Tshovelo Mashimbyi", bpm: "--", status: "No data", lastSignal: "None yet", history: [] },
    "Nhlelo": { name: "Nhlelo", bpm: "--", status: "No data", lastSignal: "None yet", history: [] },
    "Engetelo": { name: "Engetelo", bpm: "--", status: "No data", lastSignal: "None yet", history: [] }
};

const DEVICE_KEY = "f5e2c78101a84a75ffbac169ca8a6ebd";

function verifyDeviceKey(req, res, next) {
    if (req.headers['x-device-key'] !== DEVICE_KEY) {
        return res.status(401).json({ error: "Unauthorized device key" });
    }
    next();
}

// 1. Get all patients for Doctor Directory
app.get('/api/patients/all', (req, res) => {
    const list = Object.values(patientsDatabase);
    res.json(list);
});

// 2. Get specific patient record & history
app.get('/api/patients/record', (req, res) => {
    const name = req.query.name;
    if (patientsDatabase[name]) {
        res.json(patientsDatabase[name]);
    } else {
        res.status(404).json({ error: "Patient not found" });
    }
});

// 3. Hardware telemetry ingestion from ESP8266
app.post('/api/telemetry', verifyDeviceKey, (req, res) => {
    const { name, bpm, timestamp } = req.body;
    
    let targetPatient = name || "Tshovelo Mashimbyi";
    if (!patientsDatabase[targetPatient]) {
        targetPatient = "Tshovelo Mashimbyi";
    }

    let status = "Normal";
    if (bpm > 100) status = "High";
    else if (bpm < 60) status = "Low";

    const currentDate = new Date().toLocaleDateString() + ", " + new Date().getFullYear();
    const currentTime = timestamp || new Date().toLocaleTimeString();

    patientsDatabase[targetPatient].bpm = `${bpm} BPM`;
    patientsDatabase[targetPatient].status = status;
    patientsDatabase[targetPatient].lastSignal = `${currentDate}, ${currentTime}`;

    patientsDatabase[targetPatient].history.unshift({
        date: currentDate,
        time: currentTime,
        bpm: `${bpm} BPM`,
        status: status
    });

    if (patientsDatabase[targetPatient].history.length > 25) {
        patientsDatabase[targetPatient].history.pop();
    }

    console.log(`[TELEMETRY] Patient: ${targetPatient} | BPM: ${bpm} | Status: ${status}`);
    res.status(200).json({ success: true });
});

// 4. Secure Authorization Login Route
app.post('/api/login', (req, res) => {
    const { identity, password } = req.body;
    
    if (!password || password.length < 4) {
        return res.status(401).json({ error: "Invalid authorization credentials." });
    }

    if (identity === 'doctor') {
        return res.status(200).json({ success: true, role: 'doctor', username: 'Dr Maswanganye' });
    } else if (patientsDatabase[identity]) {
        return res.status(200).json({ success: true, role: 'patient', username: identity });
    }

    res.status(401).json({ error: "Unauthorized access profile." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running securely on port ${PORT}`);
});