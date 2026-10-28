const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// 1. Active hardware session state
let activeSession = {
    patient_id: 1,
    name: "Tshovelo",
    last_bpm: 0,
    last_signal: 0,
    last_updated: null
};

// 2. Patient Directory & Historical Telemetry Storage
let patientsData = {
    1: { id: 1, name: "Tshovelo", bpm: "--", status: "No data", lastSignal: "None yet", history: [] },
    2: { id: 2, name: "Nhlelo", bpm: "--", status: "No data", lastSignal: "None yet", history: [] },
    3: { id: 3, name: "Engetelo", bpm: "--", status: "No data", lastSignal: "None yet", history: [] }
};

// Device security key validation middleware
const DEVICE_KEY = "f5e2c78101a84a75ffbac169ca8a6ebd";

function verifyDeviceKey(req, res, next) {
    const key = req.headers['x-device-key'];
    if (key !== DEVICE_KEY) {
        return res.status(401).json({ error: "Unauthorized device key" });
    }
    next();
}

// --- HARDWARE API ENDPOINTS ---

// Arduino polls this to check which patient session is active
app.get('/api/arduino/status', (req, res) => {
    res.json(activeSession);
});

// Arduino posts live telemetry here
app.post('/api/telemetry', verifyDeviceKey, (req, res) => {
    const { patient_id, name, bpm, raw_signal, timestamp } = req.body;
    
    // Determine status based on BPM thresholds
    let status = "Normal";
    if (bpm > 100) status = "High";
    else if (bpm < 60) status = "Low";

    const currentTime = timestamp || new Date().toLocaleTimeString();
    const currentDate = new Date().toLocaleDateString();

    // Update active session state
    activeSession = {
        patient_id,
        name,
        last_bpm: bpm,
        last_signal: raw_signal,
        last_updated: new Date()
    };

    // Update patient record and push to history
    if (patientsData[patient_id]) {
        patientsData[patient_id].bpm = `${bpm} BPM`;
        patientsData[patient_id].status = status;
        patientsData[patient_id].lastSignal = `${currentDate}, ${currentTime}`;
        
        patientsData[patient_id].history.unshift({
            date: currentDate,
            time: currentTime,
            bpm: `${bpm} BPM`,
            status: status
        });

        // Keep history array trimmed to last 20 logs
        if (patientsData[patient_id].history.length > 20) {
            patientsData[patient_id].history.pop();
        }
    }

    console.log(`[TELEMETRY] Patient: ${name} (ID: ${patient_id}) | BPM: ${bpm} | Status: ${status}`);
    res.status(200).json({ success: true, message: "Telemetry recorded successfully" });
});

// --- WEB PORTAL ROUTES ---

// Login page
app.get('/', (req, res) => {
    res.render('index');
});

// Handle login and set active session
app.post('/api/login', (req, res) => {
    const { username, role } = req.body;
    let patientId = username === "Tshovelo" ? 1 : username === "Nhlelo" ? 2 : username === "Engetelo" ? 3 : 1;
    
    activeSession.patient_id = patientId;
    activeSession.name = username;
    activeSession.last_updated = new Date();

    if (role === 'doctor') {
        res.redirect('/doctor-dashboard');
    } else {
        res.redirect('/patient-dashboard');
    }
});

// Patient Dashboard Route
app.get('/patient-dashboard', (req, res) => {
    const currentPatient = patientsData[activeSession.patient_id] || patientsData[1];
    res.render('patient-dashboard', { 
        activeUser: activeSession.name, 
        patient: currentPatient,
        patients: patientsData 
    });
});

// Doctor Dashboard Route
app.get('/doctor-dashboard', (req, res) => {
    res.render('doctor-dashboard', { 
        activeSession: activeSession,
        patients: patientsData 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});