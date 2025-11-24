const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const router = express.Router();

const db = require(path.join(__dirname, '..', 'lib', 'db'));
const validateRegister = require(path.join(__dirname, '..', 'middleware', 'validateRegister'));

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

// POST /register
router.post('/', validateRegister, async (req, res) => {
  const { name, surname, email, password } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

     const [result] = await db.execute(
        'INSERT INTO users (name, surname, email, password_hash) VALUES (?, ?, ?, ?)',
        [name, surname, email, passwordHash]
      );

    const userId = result.insertId;

    // regenerate session to mitigate fixation, then set user
    req.session.regenerate((err) => {
      if (err) {
        // session regeneration failed, but user was created; still return success
        return res.status(201).json({ ok: true, user: { id: userId, name, surname, email } });
      }

      req.session.user = { id: userId, name, surname, email };
      res.status(201).json({ ok: true, user: { id: userId, name, surname, email } });
    });
  } catch (err) {
    // Duplicate entry handling (MySQL ER_DUP_ENTRY)
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: 'duplicate', field: 'email' });
    }

    console.error('register error', err);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
