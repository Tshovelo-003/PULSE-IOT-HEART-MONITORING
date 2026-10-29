const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let activeSession = {
    patient_id: 1,
    name: "Tshovelo",
    last_bpm: 0,
    last_signal: 0,
    last_updated: null
};

let patientsDatabase = {
    "Tshovelo": { id: 1, name: "Tshovelo", bpm: "--", status: "No data", lastSignal: "None yet", history: [] },
    "Nhlelo": { id: 2, name: "Nhlelo", bpm: "--", status: "No data", lastSignal: "None yet", history: [] },
    "Engetelo": { id: 3, name: "Engetelo", bpm: "--", status: "No data", lastSignal: "None yet", history: [] }
};

// Exact requested case-sensitive passwords (Dr Maswanganye instead of doctor)
const userPasswords = {
    "Dr Maswanganye": "Mukah@12",
    "Tshovelo": "Tshovelo@2003",
    "Nhlelo": "2019",
    "Engetelo": "2016"
};

const DEVICE_KEY = "f5e2c78101a84a75ffbac169ca8a6ebd";

function verifyDeviceKey(req, res, next) {
    if (req.headers['x-device-key'] !== DEVICE_KEY) {
        return res.status(401).json({ error: "Unauthorized device key" });
    }
    next();
}

app.get('/api/arduino/status', (req, res) => {
    res.json(activeSession);
});

app.get('/api/patients/all', (req, res) => {
    const list = Object.values(patientsDatabase).map(p => {
        let isLive = false;
        if (p.lastSignal !== "None yet" && activeSession.name === p.name) {
            const diffSec = (new Date() - new Date(activeSession.last_updated)) / 1000;
            if (diffSec < 15) isLive = true;
        }
        return { ...p, isLive };
    });
    res.json(list);
});

app.get('/api/patients/record', (req, res) => {
    const name = req.query.name;
    if (patientsDatabase[name]) {
        res.json(patientsDatabase[name]);
    } else {
        res.status(404).json({ error: "Patient not found" });
    }
});

app.post('/api/telemetry', verifyDeviceKey, (req, res) => {
    const { patient_id, name, bpm, raw_signal, timestamp } = req.body;
    
    let targetName = name || activeSession.name;
    if (!patientsDatabase[targetName]) {
        targetName = "Tshovelo";
    }

    let status = "Normal";
    if (bpm > 100) {
        status = "High";
    } else if (bpm < 60 && bpm > 0) {
        status = "Low";
    }

    const currentDate = new Date().toLocaleDateString() + ", " + new Date().getFullYear();
    const currentTime = timestamp || new Date().toLocaleTimeString();

    activeSession = {
        patient_id: patient_id || 1,
        name: targetName,
        last_bpm: bpm,
        last_signal: raw_signal,
        last_updated: new Date()
    };

    patientsDatabase[targetName].bpm = `${bpm} BPM`;
    patientsDatabase[targetName].status = status;
    patientsDatabase[targetName].lastSignal = `${currentDate}, ${currentTime}`;

    patientsDatabase[targetName].history.unshift({
        date: currentDate,
        time: currentTime,
        bpm: `${bpm} BPM`,
        status: status
    });

    if (patientsDatabase[targetName].history.length > 25) {
        patientsDatabase[targetName].history.pop();
    }

    res.status(200).json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { identity, password } = req.body;
    
    if (identity === 'Dr Maswanganye') {
        if (password !== userPasswords["Dr Maswanganye"]) {
            return res.status(401).json({ error: "Invalid password or case mismatch." });
        }
        return res.status(200).json({ success: true, role: 'doctor', username: 'Dr Maswanganye' });
    } else if (patientsDatabase[identity]) {
        if (password !== userPasswords[identity]) {
            return res.status(401).json({ error: "Invalid password or case mismatch." });
        }
        activeSession.name = identity;
        activeSession.patient_id = patientsDatabase[identity].id;
        return res.status(200).json({ success: true, role: 'patient', username: identity });
    }

    res.status(401).json({ error: "Unauthorized access profile." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running securely on port ${PORT}`);
});