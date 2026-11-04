const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const LIVE_WINDOW_MS = 8000; // a reading older than this = "No Signal"

function emptySession() {
    return {
        patient_id: null,
        name: "",
        last_bpm: 0,
        last_signal: 0,
        last_updated: null
    };
}

let activeSession = emptySession();

let patientsDatabase = {
    "Tshovelo": { id: 1, name: "Tshovelo", bpm: "--", status: "No data", lastSignal: "None yet", history: [] },
    "Nhlelo": { id: 2, name: "Nhlelo", bpm: "--", status: "No data", lastSignal: "None yet", history: [] },
    "Engetelo": { id: 3, name: "Engetelo", bpm: "--", status: "No data", lastSignal: "None yet", history: [] }
};

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

// True only if this patient is logged in AND a fresh reading arrived recently
function isPatientLive(name) {
    if (!activeSession.name || activeSession.name !== name) return false;
    if (!activeSession.last_updated) return false;
    return (Date.now() - new Date(activeSession.last_updated).getTime()) < LIVE_WINDOW_MS;
}

// ---------- Arduino polls this to know who is logged in ----------
app.get('/api/arduino/status', (req, res) => {
    res.json(activeSession);
});

// ---------- Logout ----------
app.post('/api/logout', (req, res) => {
    const who = req.body && (req.body.username || req.body.identity);
    // A different user (e.g. the doctor) signing out must not log the patient out
    if (who && activeSession.name && who !== activeSession.name) {
        return res.status(200).json({ success: true, ignored: true });
    }
    activeSession = emptySession();
    res.status(200).json({ success: true });
});

// ---------- Doctor directory ----------
app.get('/api/patients/all', (req, res) => {
    const list = Object.values(patientsDatabase).map(p => {
        const live = isPatientLive(p.name);
        return {
            ...p,
            bpm: live ? `${activeSession.last_bpm} BPM` : "--",
            status: live ? p.status : "No Signal",
            isLive: live
        };
    });
    res.json(list);
});

// ---------- Single patient record ----------
app.get('/api/patients/record', (req, res) => {
    const name = req.query.name;
    const p = patientsDatabase[name];
    if (!p) {
        return res.status(404).json({ error: "Patient not found" });
    }

    const live = isPatientLive(name);
    res.json({
        ...p,
        bpm: live ? String(activeSession.last_bpm) : "--",   // number only; the page adds the "BPM" label
        status: live ? p.status : "No Signal",
        isLive: live,
        serverTime: Date.now()
    });
});

// ---------- Telemetry from the Arduino ----------
app.post('/api/telemetry', verifyDeviceKey, (req, res) => {
    const { name, bpm, raw_signal, timestamp } = req.body;

    // Nobody logged in -> refuse (stops a logged-out patient coming back)
    if (!activeSession.name) {
        return res.status(409).json({ error: "No active patient" });
    }
    // Reading is for someone other than the logged-in patient -> refuse
    if (name && name !== activeSession.name) {
        return res.status(409).json({ error: "Patient mismatch" });
    }

    const bpmNum = Number(bpm);
    if (!(bpmNum > 0)) {
        return res.status(400).json({ error: "Invalid bpm" });
    }

    const targetName = activeSession.name;
    if (!patientsDatabase[targetName]) {
        return res.status(400).json({ error: "Invalid patient target" });
    }

    let status = "Normal";
    if (bpmNum > 100) status = "High";
    else if (bpmNum < 60) status = "Low";

    const currentDate = new Date().toLocaleDateString() + ", " + new Date().getFullYear();
    const currentTime = timestamp || new Date().toLocaleTimeString();

    // Only update readings, never the logged-in identity
    activeSession.last_bpm = bpmNum;
    activeSession.last_signal = raw_signal;
    activeSession.last_updated = new Date();

    patientsDatabase[targetName].bpm = `${bpmNum} BPM`;
    patientsDatabase[targetName].status = status;
    patientsDatabase[targetName].lastSignal = `${currentDate}, ${currentTime}`;

    patientsDatabase[targetName].history.unshift({
        date: currentDate,
        time: currentTime,
        bpm: `${bpmNum} BPM`,
        status: status
    });

    if (patientsDatabase[targetName].history.length > 25) {
        patientsDatabase[targetName].history.pop();
    }

    res.status(200).json({ success: true });
});

// ---------- Login ----------
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
        activeSession = {
            patient_id: patientsDatabase[identity].id,
            name: identity,
            last_bpm: 0,
            last_signal: 0,
            last_updated: null      // fresh login = no signal until the sensor sends data
        };
        return res.status(200).json({ success: true, role: 'patient', username: identity });
    }

    res.status(401).json({ error: "Unauthorized access profile." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running securely on port ${PORT}`);
});