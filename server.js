const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const bcrypt     = require('bcryptjs');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json());

// ===================== DATA FILES =====================
const DATA_DIR   = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE  = path.join(DATA_DIR, 'users.json');
const CODES_FILE  = path.join(DATA_DIR, 'redeem_codes.json');

const OWNER_KEY  = 'EVAN13_OWNER_2024';
const OWNER_EMAIL = 'evanziggy1013@gmail.com';
const PREM3_EMAILS = ['evanziggy1008@gmail.com'];
const PREM1_EMAILS = ['evanziggy0813@gmail.com'];

// ===================== HELPER =====================
function loadJson(file, def) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e) {}
    return def;
}
function saveJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function determineType(email) {
    if (email === OWNER_EMAIL)            return 'owner';
    if (PREM3_EMAILS.includes(email))     return 'premium_v3';
    if (PREM1_EMAILS.includes(email))     return 'premium_v1';
    return 'free';
}

function tokenLimit(type) {
    switch(type) {
        case 'owner':      return -1;
        case 'premium_v3': return 10;
        case 'premium_v2': return 5;
        case 'premium_v1': return 2;
        default:           return 1;
    }
}

// Fitur yang otomatis terbuka per tipe akun
function defaultFeatures(type) {
    // Fitur default sama untuk semua akun - premium hanya tambah token
    // Fitur tambahan (ai_dark, ai_tsundere, report, prankwifi, otp) harus pakai kode redeem
    var base = ['info','game','ai_normal','call','custom','otp'];
    if (type === 'owner') {
        // Owner langsung dapat semua fitur
        return ['info','game','ai_normal','ai_dark','ai_tsundere','call','custom','otp','report','prankwifi'];
    }
    return base;
}

// ===================== AUTH =====================

// Register
app.post('/api/auth/register', async function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var { username, email, password } = req.body;
    if (!username || !email || !password)
        return res.status(400).json({ error: 'username, email, password wajib' });
    if (users[email])
        return res.status(409).json({ error: 'Email sudah terdaftar!' });

    var hash   = await bcrypt.hash(password, 10);
    var type   = determineType(email);
    var feats  = defaultFeatures(type);

    users[email] = {
        username,
        email,
        password: hash,
        accountType: type,
        unlockedFeatures: feats,
        tokenUsed: {},
        createdAt: new Date().toISOString()
    };
    saveJson(USERS_FILE, users);
    res.json({ success: true, user: sanitize(users[email]) });
});

// Login
app.post('/api/auth/login', async function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: 'email dan password wajib' });

    var user = users[email];
    if (!user) return res.status(404).json({ error: 'Akun tidak ditemukan! Daftar dulu.' });

    var ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Password salah!' });

    // Update tipe akun dari email (kalau email di-upgrade manual)
    var newType = determineType(email);
    if (newType !== 'free' && user.accountType === 'free') {
        user.accountType = newType;
        user.unlockedFeatures = defaultFeatures(newType);
        saveJson(USERS_FILE, users);
    }

    res.json({ success: true, user: sanitize(user) });
});

// Get profile
app.get('/api/auth/profile', function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var email = req.query.email;
    if (!email || !users[email])
        return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json({ user: sanitize(users[email]) });
});

// ===================== FITUR & TOKEN =====================

// Cek dan pakai token
app.post('/api/user/use-token', function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var { email, feature } = req.body;
    if (!email || !feature) return res.status(400).json({ error: 'email dan feature wajib' });
    var user = users[email];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

    // Owner: unlimited
    if (user.accountType === 'owner') return res.json({ ok: true, remaining: -1 });

    // Cek apakah fitur terbuka
    if (!user.unlockedFeatures.includes(feature))
        return res.status(403).json({ ok: false, error: 'Fitur terkunci!' });

    var today   = new Date().toISOString().slice(0,10);
    var limit   = tokenLimit(user.accountType);
    var used    = (user.tokenUsed[today] || 0);

    if (used >= limit)
        return res.status(429).json({ ok: false, error: 'Token harian habis!', remaining: 0 });

    user.tokenUsed[today] = used + 1;
    saveJson(USERS_FILE, users);
    res.json({ ok: true, remaining: limit - (used+1), used: used+1, limit });
});

// Unlock fitur
app.post('/api/user/unlock-feature', function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var { email, feature } = req.body;
    if (!email || !feature) return res.status(400).json({ error: 'email dan feature wajib' });
    var user = users[email];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    if (!user.unlockedFeatures.includes(feature)) {
        user.unlockedFeatures.push(feature);
        saveJson(USERS_FILE, users);
    }
    res.json({ ok: true });
});

// Upgrade akun
app.post('/api/user/upgrade', function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var { email, newType } = req.body;
    if (!email || !newType) return res.status(400).json({ error: 'email dan newType wajib' });
    var user = users[email];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

    user.accountType = newType;
    // Tambahkan fitur baru yang sesuai tipe
    var newFeats = defaultFeatures(newType);
    newFeats.forEach(function(f) {
        if (!user.unlockedFeatures.includes(f)) user.unlockedFeatures.push(f);
    });
    saveJson(USERS_FILE, users);
    res.json({ ok: true, user: sanitize(user) });
});

// ===================== REDEEM CODE =====================
app.post('/api/redeem/create', function(req, res) {
    var { feature, count, owner_key } = req.body;
    if (owner_key !== OWNER_KEY) return res.status(403).json({ error: 'Bukan Owner!' });
    if (!feature) return res.status(400).json({ error: 'feature wajib' });

    var codes = loadJson(CODES_FILE, {});
    count = Math.min(parseInt(count) || 1, 50);

    var generated = [];
    for (var i = 0; i < count; i++) {
        var letters = 'abcdefghijklmnopqrstuvwxyz';
        var r5 = '', r5n = '';
        for (var j=0;j<5;j++) r5 += letters[Math.floor(Math.random()*26)];
        for (var j=0;j<5;j++) r5n += Math.floor(Math.random()*10);
        var now = new Date();
        var dateStr = now.getDate()+'/'+(now.getMonth()+1)+'/'+String(now.getFullYear()).slice(2);
        var code = r5 + '-' + r5n + '-' + dateStr;
        codes[code] = { feature, used: false, usedBy: null, createdAt: dateStr };
        generated.push({ code, feature });
    }
    saveJson(CODES_FILE, codes);
    res.json({ success: true, codes: generated });
});

app.get('/api/redeem/list', function(req, res) {
    if (req.query.owner_key !== OWNER_KEY)
        return res.status(403).json({ error: 'Bukan Owner!' });
    res.json({ codes: loadJson(CODES_FILE, {}) });
});

app.post('/api/redeem/use', async function(req, res) {
    var { code, email } = req.body;
    if (!code || !email) return res.status(400).json({ error: 'code dan email wajib' });

    var codes = loadJson(CODES_FILE, {});
    var users = loadJson(USERS_FILE, {});
    var entry = codes[code];

    if (!entry) return res.status(404).json({ valid: false, error: 'Kode tidak valid!' });
    if (entry.used) return res.status(400).json({ valid: false, error: 'Kode sudah digunakan!' });

    var user = users[email];
    if (!user) return res.status(404).json({ valid: false, error: 'User tidak ditemukan!' });

    var feature = entry.feature;
    codes[code].used   = true;
    codes[code].usedBy = email;
    saveJson(CODES_FILE, codes);

    if (feature.startsWith('upgrade_')) {
        var newType = feature.replace('upgrade_','');
        user.accountType = newType;
        var newFeats = defaultFeatures(newType);
        newFeats.forEach(function(f) {
            if (!user.unlockedFeatures.includes(f)) user.unlockedFeatures.push(f);
        });
    } else {
        if (!user.unlockedFeatures.includes(feature)) user.unlockedFeatures.push(feature);
    }
    saveJson(USERS_FILE, users);
    res.json({ valid: true, feature, user: sanitize(user), message: 'Kode berhasil digunakan!' });
});

// ===================== UTIL =====================
function sanitize(user) {
    return {
        username: user.username,
        email: user.email,
        accountType: user.accountType,
        unlockedFeatures: user.unlockedFeatures,
        tokenUsed: user.tokenUsed
    };
}

app.get('/', function(req, res) {
    res.json({ status: 'Vanzzz Server 2 berjalan', version: '1.0.0' });
});

app.listen(PORT, function() {
    console.log('Vanzzz Server 2 jalan di port ' + PORT);
});
