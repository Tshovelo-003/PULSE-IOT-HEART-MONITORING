const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // For CSS/JS assets if you have them

// Active session state synchronized with your ESP8266 hardware
let activeSession = {
    patient_id: 0,
    name: "Waiting",
    last_bpm: 0,
    last_signal: 0,
    last_updated: null
};

// Device security key verification middleware
const DEVICE_KEY = "f5e2c78101a84a75ffbac169ca8a6ebd";

function verifyDeviceKey(req, res, next) {
    const key = req.headers['x-device-key'];
    if (key !== DEVICE_KEY) {
        return res.status(401).json({ error: "Unauthorized device key" });
    }
    next();
}

// 1. API: Arduino checks active session status
app.get('/api/arduino/status', (req, res) => {
    res.json(activeSession);
});

// 2. API: Arduino posts live telemetry
app.post('/api/telemetry', verifyDeviceKey, (req, res) => {
    const { patient_id, name, bpm, raw_signal, timestamp } = req.body;
    
    activeSession = {
        patient_id,
        name,
        last_bpm: bpm,
        last_signal: raw_signal,
        last_updated: new Date()
    };

    console.log(`[TELEMETRY] Patient: ${name} (ID: ${patient_id}) | BPM: ${bpm} | Time: ${timestamp}`);
    res.status(200).json({ success: true, message: "Telemetry recorded successfully" });
});

// 3. Login Route
app.get('/', (req, res) => {
    res.render('index'); // Renders your login view
});

app.post('/api/login', (req, res) => {
    const { username, role } = req.body;
    let patientId = username === "Tshovelo" ? 1 : username === "Nhlelo" ? 2 : username === "Engetelo" ? 3 : 0;
    
    activeSession.patient_id = patientId;
    activeSession.name = username;
    activeSession.last_updated = new Date();

    if (role === 'doctor') {
        res.redirect('/doctor-dashboard');
    } else {
        res.redirect('/patient-dashboard');
    }
});

app.get('/patient-dashboard', (req, res) => {
    res.render('patient-dashboard', { activeUser: activeSession });
});

app.get('/doctor-dashboard', (req, res) => {
    res.render('doctor-dashboard', { activeSession });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});