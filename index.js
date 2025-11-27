const express = require('express');
const session = require('express-session');
const path = require('path');
require('dotenv').config()

const isAuth = require(path.join(__dirname, 'middleware', 'isAuth'));

// add bcrypt and db pool
const bcrypt = require('bcrypt');
const db = require(path.join(__dirname, 'lib', 'db'));

const app = express();
app.use(express.json());

// Use MySQL-backed session store
const MySQLStore = require('express-mysql-session')(session);

// MySQL connection options (use env vars in production)
const mysqlOptions = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT, 10) : 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'session_test',
  // You can add connectionLimit and other pool options here
};

const sessionStore = new MySQLStore(mysqlOptions);

// Minimal, safe-for-local/dev express-session setup
app.set('trust proxy', 1); // if testing behind a proxy (optional for dev)
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

// IMPORTANT: mount session middleware before any route that relies on req.session / isAuth
app.use(
  session({
    name: 'sid', // session cookie name
    secret: SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // set to true if you serve via HTTPS in production
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// mount whoami route (place after other app.use(...) calls and before app.listen)
app.use('/whoami', isAuth, require(path.join(__dirname, 'routes', 'whoami')));

// mount register route
app.use('/register', require(path.join(__dirname, 'routes', 'register')));

// mount cards route
app.use('/cards', isAuth, require(path.join(__dirname, 'routes', 'cards', 'cards')));

// mount sets route
app.use('/sets', isAuth, require(path.join(__dirname, 'routes', 'sets', 'sets')));

// Test endpoint: increments a session counter and returns session data
// OCIO DA TOGLIERE IN PRODUZIONE CHE ALTRIMENTI PERMETTE DI FARE UN XSS COI COOKIE
app.get('/test', (req, res) => {
  req.session.views = (req.session.views || 0) + 1;
  res.json({
    message: 'session test',
    views: req.session.views,
    sessionId: req.sessionID,
    session: req.session,
  });
});

// Updated login endpoint: authenticate against users table and set session.user
app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  const errors = {};
  if (!email || typeof email !== 'string' || !email.trim()) errors.email = 'Email is required';
  if (!password || typeof password !== 'string') errors.password = 'Password is required';
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, error: 'validation', details: errors });

  const emailNorm = email.trim().toLowerCase();

  try {
    const [rows] = await db.execute(
      'SELECT id, name, surname, email, password_hash FROM users WHERE email = ? LIMIT 1',
      [emailNorm]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }

    // regenerate session to mitigate fixation, then set user
    req.session.regenerate((err) => {
      const safeUser = { id: user.id, name: user.name, surname: user.surname, email: user.email };
      if (err) {
        console.error('session regenerate error', err);
        // fallback: set user on existing session and return success
        req.session.user = safeUser;
        return res.json({ ok: true, user: safeUser });
      }

      req.session.user = safeUser;
      res.json({ ok: true, user: safeUser });
    });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});


// Logout: destroy the session
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ ok: false, error: 'Failed to destroy session' });
    }
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

// Protected endpoint using existing middleware
app.get('/private', isAuth, (req, res) => {
  res.json({ message: 'This is a protected resource', user: req.session.user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
