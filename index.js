const express = require('express');
const session = require('express-session');
const path = require('path');

const isAuth = require(path.join(__dirname, 'middleware', 'isAuth'));

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

// Test endpoint: increments a session counter and returns session data
app.get('/test', (req, res) => {
  req.session.views = (req.session.views || 0) + 1;
  res.json({
    message: 'session test',
    views: req.session.views,
    sessionId: req.sessionID,
    session: req.session,
  });
});

// Small login endpoint to demonstrate setting a session user
app.post('/login', (req, res) => {
  // In real app validate credentials from req.body
  const demoUser = { id: 'dev-user', name: 'Developer' };
  req.session.user = demoUser;
  // Optional: regenerate session to mitigate fixation
  // req.session.regenerate(() => { req.session.user = demoUser; res.json({ ok: true, user: demoUser }); });
  res.json({ ok: true, user: demoUser });
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
  console.log('Endpoints: GET /test, POST /login, POST /logout, GET /private');
});
