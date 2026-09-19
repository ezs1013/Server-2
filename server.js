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
const DATA_DIR  = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE  = path.join(DATA_DIR, 'users.json');
const CODES_FILE  = path.join(DATA_DIR, 'redeem_codes.json');
const BAL_CODES   = path.join(DATA_DIR, 'balance_codes.json');

const OWNER_EMAIL = 'evanziggy1013@gmail.com';
const OWNER_KEY   = 'EVAN13_OWNER_2024';

// ===================== HARGA FITUR =====================
const FEATURE_PRICES = {
    'otp':         4000,
    'ai_dark':     4000,
    'email':       4000,
    'bugwa':       5000,
    'report':      6000,
    'upgrade_premium_v1': 2000,
    'upgrade_premium_v2': 4000,
    'upgrade_premium_v3': 6000,
    'upgrade_max':        30000,
    'upgrade_admin':      40000,
    // Gratis
    'call':     0,
    'custom':   0,
    'info':     0,
    'ai_normal':0,
    'ai_tsundere':0,
    'game':     0,
};

// ===================== TIPE AKUN =====================
const TYPE_ORDER = ['free','premium_v1','premium_v2','premium_v3','max','admin','owner'];

function tokenLimit(type) {
    switch(type) {
        case 'owner': case 'admin': return -1;
        case 'max':        return 30;
        case 'premium_v3': return 10;
        case 'premium_v2': return 5;
        case 'premium_v1': return 2;
        default:           return 1;
    }
}

function defaultFeatures(type) {
    var base = ['info','game','ai_normal','call','custom'];
    if (type === 'owner' || type === 'admin') {
        return ['info','game','ai_normal','ai_dark','ai_tsundere','call','custom','otp','report','email','bugwa'];
    }
    return base;
}

function determineType(email) {
    if (email === OWNER_EMAIL) return 'owner';
    return 'free';
}

// ===================== HELPER =====================
function loadJson(file, def) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e) {}
    return def;
}
function saveJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function sanitize(user) {
    return {
        username:         user.username,
        email:            user.email,
        accountType:      user.accountType,
        unlockedFeatures: user.unlockedFeatures,
        tokenUsed:        user.tokenUsed,
        balance:          user.balance || 0
    };
}

// ===================== AUTH =====================
app.post('/api/auth/register', async function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var { username, email, password } = req.body;
    if (!username || !email || !password)
        return res.status(400).json({ error: 'username, email, password wajib' });
    if (users[email])
        return res.status(409).json({ error: 'Email sudah terdaftar!' });

    var hash  = await bcrypt.hash(password, 10);
    var type  = determineType(email);
    users[email] = {
        username, email,
        password:         hash,
        accountType:      type,
        unlockedFeatures: defaultFeatures(type),
        tokenUsed:        {},
        balance:          0,
        createdAt:        new Date().toISOString()
    };
    saveJson(USERS_FILE, users);
    res.json({ success: true, user: sanitize(users[email]) });
});

app.post('/api/auth/login', async function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: 'email dan password wajib' });
    var user = users[email];
    if (!user) return res.status(404).json({ error: 'Akun tidak ditemukan! Daftar dulu.' });
    var ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Password salah!' });
    if (user.balance === undefined) user.balance = 0;
    saveJson(USERS_FILE, users);
    res.json({ success: true, user: sanitize(user) });
});

app.get('/api/auth/profile', function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var email = req.query.email;
    if (!email || !users[email])
        return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json({ user: sanitize(users[email]) });
});

// ===================== SALDO =====================

// Cek saldo
app.get('/api/balance', function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var { email } = req.query;
    if (!email || !users[email]) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json({ balance: users[email].balance || 0 });
});

// Buat kode saldo (Owner only)
app.post('/api/balance/create-code', function(req, res) {
    var { owner_key, amount, count } = req.body;
    if (owner_key !== OWNER_KEY) return res.status(403).json({ error: 'Bukan Owner!' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Nominal saldo wajib' });

    var n    = Math.min(parseInt(count) || 1, 100);
    var codes = loadJson(BAL_CODES, {});
    var generated = [];

    for (var i = 0; i < n; i++) {
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        var code  = 'SAL-';
        for (var j = 0; j < 12; j++) {
            if (j === 4 || j === 8) code += '-';
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        codes[code] = { amount: parseInt(amount), used: false, usedBy: null, createdAt: new Date().toISOString() };
        generated.push({ code, amount: parseInt(amount) });
    }
    saveJson(BAL_CODES, codes);
    res.json({ success: true, codes: generated });
});

// List kode saldo (Owner)
app.get('/api/balance/codes', function(req, res) {
    if (req.query.owner_key !== OWNER_KEY) return res.status(403).json({ error: 'Bukan Owner!' });
    res.json({ codes: loadJson(BAL_CODES, {}) });
});

// Redeem kode saldo
app.post('/api/balance/redeem', function(req, res) {
    var { code, email } = req.body;
    if (!code || !email) return res.status(400).json({ error: 'code dan email wajib' });

    var codes = loadJson(BAL_CODES, {});
    var users = loadJson(USERS_FILE, {});
    var entry = codes[code.toUpperCase()];

    if (!entry) return res.status(404).json({ error: 'Kode saldo tidak valid!' });
    if (entry.used) return res.status(400).json({ error: 'Kode sudah digunakan!' });

    var user = users[email];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan!' });

    user.balance = (user.balance || 0) + entry.amount;
    entry.used   = true;
    entry.usedBy = email;
    entry.usedAt = new Date().toISOString();

    saveJson(BAL_CODES, codes);
    saveJson(USERS_FILE, users);
    res.json({ success: true, added: entry.amount, balance: user.balance });
});

// Beli fitur dengan saldo
app.post('/api/balance/buy-feature', function(req, res) {
    var { email, feature } = req.body;
    if (!email || !feature) return res.status(400).json({ error: 'email dan feature wajib' });

    var users = loadJson(USERS_FILE, {});
    var user  = users[email];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan!' });

    var price = FEATURE_PRICES[feature];
    if (price === undefined) return res.status(400).json({ error: 'Fitur tidak dikenal' });

    // Gratis
    if (price === 0) {
        if (!user.unlockedFeatures.includes(feature)) user.unlockedFeatures.push(feature);
        saveJson(USERS_FILE, users);
        return res.json({ success: true, balance: user.balance, message: 'Fitur gratis diaktifkan!' });
    }

    var balance = user.balance || 0;
    if (balance < price) return res.status(402).json({ error: 'Saldo tidak cukup!', balance, price });

    // Proses pembelian
    user.balance = balance - price;

    if (feature.startsWith('upgrade_')) {
        var newType = feature.replace('upgrade_','');
        var curIdx  = TYPE_ORDER.indexOf(user.accountType);
        var newIdx  = TYPE_ORDER.indexOf(newType);
        if (newIdx > curIdx) {
            user.accountType = newType;
            defaultFeatures(newType).forEach(function(f) {
                if (!user.unlockedFeatures.includes(f)) user.unlockedFeatures.push(f);
            });
        }
    } else {
        if (!user.unlockedFeatures.includes(feature)) user.unlockedFeatures.push(feature);
    }

    saveJson(USERS_FILE, users);
    res.json({ success: true, balance: user.balance, feature, price, user: sanitize(user) });
});

// ===================== TOKEN =====================
app.post('/api/user/use-token', function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var { email, feature } = req.body;
    if (!email || !feature) return res.status(400).json({ error: 'email dan feature wajib' });
    var user = users[email];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    if (user.accountType === 'owner' || user.accountType === 'admin') return res.json({ ok: true, remaining: -1 });
    if (!user.unlockedFeatures.includes(feature))
        return res.status(403).json({ ok: false, error: 'Fitur terkunci!' });
    var today = new Date().toISOString().slice(0,10);
    var limit = tokenLimit(user.accountType);
    var used  = (user.tokenUsed[today] || 0);
    if (limit !== -1 && used >= limit)
        return res.status(429).json({ ok: false, error: 'Token harian habis!', remaining: 0 });
    user.tokenUsed[today] = used + 1;
    saveJson(USERS_FILE, users);
    res.json({ ok: true, remaining: limit === -1 ? -1 : limit - (used+1), used: used+1, limit });
});

// ===================== REDEEM CODE FITUR (LAMA — tetap support) =====================
app.post('/api/redeem/create', function(req, res) {
    if (req.body.owner_key !== OWNER_KEY) return res.status(403).json({ error: 'Bukan Owner!' });
    var features = req.body.features || (req.body.feature ? [req.body.feature] : null);
    if (!features || !features.length) return res.status(400).json({ error: 'features wajib' });
    var count = Math.min(parseInt(req.body.count)||1, 50);
    var codes = loadJson(CODES_FILE, {});
    var generated = [];
    for (var i = 0; i < count; i++) {
        var letters = 'abcdefghijklmnopqrstuvwxyz';
        var r5='', r5n='';
        for(var j=0;j<5;j++) r5  += letters[Math.floor(Math.random()*26)];
        for(var j=0;j<5;j++) r5n += Math.floor(Math.random()*10);
        var now = new Date();
        var ds  = now.getDate()+'/'+(now.getMonth()+1)+'/'+String(now.getFullYear()).slice(2);
        var code = r5+'-'+r5n+'-'+ds;
        codes[code] = { features, used:false, usedBy:null, createdAt:ds };
        generated.push({ code, features });
    }
    saveJson(CODES_FILE, codes);
    res.json({ success:true, codes:generated });
});

app.get('/api/redeem/list', function(req, res) {
    if (req.query.owner_key !== OWNER_KEY) return res.status(403).json({ error: 'Bukan Owner!' });
    res.json({ codes: loadJson(CODES_FILE, {}) });
});

app.post('/api/redeem/use', async function(req, res) {
    var { code, email } = req.body;
    if (!code || !email) return res.status(400).json({ error: 'code dan email wajib' });
    var codes = loadJson(CODES_FILE, {});
    var users = loadJson(USERS_FILE, {});
    var entry = codes[code];
    if (!entry) return res.status(404).json({ valid:false, error:'Kode tidak valid!' });
    if (entry.used) return res.status(400).json({ valid:false, error:'Kode sudah digunakan!' });
    var user = users[email];
    if (!user) return res.status(404).json({ valid:false, error:'User tidak ditemukan!' });
    var features = entry.features || (entry.feature ? [entry.feature] : []);
    features.forEach(function(feature) {
        if (feature.startsWith('upgrade_')) {
            var newType = feature.replace('upgrade_','');
            var curIdx = TYPE_ORDER.indexOf(user.accountType);
            var newIdx = TYPE_ORDER.indexOf(newType);
            if (newIdx > curIdx) user.accountType = newType;
        } else {
            if (!user.unlockedFeatures.includes(feature)) user.unlockedFeatures.push(feature);
        }
    });
    delete codes[code];
    saveJson(CODES_FILE, codes);
    saveJson(USERS_FILE, users);
    res.json({ valid:true, features, user:sanitize(user), message:'Kode berhasil digunakan!' });
});

// ===================== OWNER: Buat kode saldo via menu akun =====================
app.post('/api/owner/create-balance-code', function(req, res) {
    var users = loadJson(USERS_FILE, {});
    var { email, password, amount, count } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email dan password wajib' });
    var user = users[email];
    if (!user || user.accountType !== 'owner')
        return res.status(403).json({ error: 'Bukan Owner!' });

    bcrypt.compare(password, user.password, function(err, ok) {
        if (!ok) return res.status(401).json({ error: 'Password salah!' });
        if (!amount || amount <= 0) return res.status(400).json({ error: 'Nominal wajib' });
        var n     = Math.min(parseInt(count)||1, 100);
        var codes = loadJson(BAL_CODES, {});
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        var generated = [];
        for (var i = 0; i < n; i++) {
            var code = 'SAL-';
            for (var j = 0; j < 12; j++) {
                if (j === 4 || j === 8) code += '-';
                code += chars[Math.floor(Math.random()*chars.length)];
            }
            codes[code] = { amount:parseInt(amount), used:false, usedBy:null, createdAt:new Date().toISOString() };
            generated.push({ code, amount:parseInt(amount) });
        }
        saveJson(BAL_CODES, codes);
        res.json({ success:true, codes:generated });
    });
});

// ===================== UTIL =====================
app.get('/', function(req, res) {
    res.json({ status:'Vanzzz Server 2 berjalan', version:'2.0.0' });
});

app.listen(PORT, function() {
    console.log('Vanzzz Server 2 jalan di port '+PORT);
});
