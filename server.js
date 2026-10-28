const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Active hardware session state
let activeSession = {
    patient_id: 1,
    name: "Tshovelo",
    last_bpm: 0,
    last_signal: 0,
    last_updated: null
};

// Device security key validation middleware
const DEVICE_KEY = "f5e2c78101a84a75ffbac169ca8a6ebd";

function verifyDeviceKey(req, res, next) {
    if (req.headers['x-device-key'] !== DEVICE_KEY) {
        return res.status(401).json({ error: "Unauthorized device key" });
    }
    next();
}

// 1. Arduino polls active session state
app.get('/api/arduino/status', (req, res) => {
    res.json(activeSession);
});

// 2. Arduino posts live telemetry
app.post('/api/telemetry', verifyDeviceKey, (req, res) => {
    const { patient_id, name, bpm, raw_signal, timestamp } = req.body;
    
    activeSession = {
        patient_id,
        name,
        last_bpm: bpm,
        last_signal: raw_signal,
        last_updated: new Date()
    };

    console.log(`[TELEMETRY] Patient: ${name} | BPM: ${bpm}`);
    res.status(200).json({ success: true });
});

// 3. Web Login Handler
app.post('/api/login', (req, res) => {
    const { username, role } = req.body;
    let patientId = username === "Tshovelo" ? 1 : username === "Nhlelo" ? 2 : 1;
    
    activeSession.patient_id = patientId;
    activeSession.name = username;
    activeSession.last_updated = new Date();

    res.status(200).json({ success: true, role });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});