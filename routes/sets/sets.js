const express = require('express');
const path = require('path');
const router = express.Router();

const db = require(path.join(__dirname, '..', '..', 'lib', 'db'));
const isAuth = require(path.join(__dirname, '..', '..', 'middleware', 'isAuth'));
const { containerClient } = require(path.join(__dirname, '..', '..', 'lib', 'azure'));

// POST /sets
// Body: { name: string }
// Creates a new set (preset) with the provided name and the user id from session
router.post('/', isAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'validation', details: { name: 'Name is required' } });
  }

  const userId = req.session && req.session.user && req.session.user.id;
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const [result] = await db.execute(
      'INSERT INTO preset (name, userid) VALUES (?, ?)',
      [name.trim(), userId]
    );

    return res.status(201).json({ ok: true, set: { id: result.insertId, name: name.trim(), user_id: userId } });
  } catch (err) {
    console.error('POST /sets error', err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// GET /sets
// Returns all sets that belong to the authenticated user
router.get('/', isAuth, async (req, res) => {
  const userId = req.session && req.session.user && req.session.user.id;
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const [rows] = await db.execute('SELECT id, name FROM preset WHERE userid = ?', [userId]);
    return res.status(200).json({ ok: true, sets: rows || [] });
  } catch (err) {
    console.error('GET /sets error', err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// --- New endpoints to manage preset <-> card associations ---

// POST /sets/:id/cards
// Body: [{ id: number }]
// Adds multiple cards to a preset (creates rows in preset_cards). Accepts an array of objects with the form { id: number }.
router.put('/:id/cards', isAuth, async (req, res) => {
  const presetId = parseInt(req.params.id, 10);
  const userId = req.session && req.session.user && req.session.user.id;

  if (Number.isNaN(presetId) || presetId <= 0) {
    return res.status(400).json({ ok: false, error: 'validation', details: { presetId: 'Invalid preset id' } });
  }
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const payload = req.body;
  if (!Array.isArray(payload) || payload.length === 0) {
    return res.status(400).json({ ok: false, error: 'validation', details: { body: 'Expected a non-empty array of { id: number }' } });
  }

  // extract numeric ids and validate shape
  const cardIds = [];
  for (let i = 0; i < payload.length; i++) {
    const item = payload[i];
    if (!item || typeof item !== 'object' || Number.isNaN(Number(item.id))) {
      return res.status(400).json({ ok: false, error: 'validation', details: { [`items.${i}`]: 'Each item must be an object with numeric id' } });
    }
    const cid = parseInt(item.id, 10);
    if (cid <= 0) {
      return res.status(400).json({ ok: false, error: 'validation', details: { [`items.${i}`]: 'id must be a positive integer' } });
    }
    cardIds.push(cid);
  }

  // dedupe cardIds
  const uniqueCardIds = Array.from(new Set(cardIds));

  try {
    // ensure preset exists and belongs to the user
    const [presetRows] = await db.execute('SELECT id FROM preset WHERE id = ? AND userid = ? LIMIT 1', [presetId, userId]);
    if (!presetRows || presetRows.length === 0) {
      return res.status(404).json({ ok: false, error: 'preset_not_found' });
    }

    // ensure cards exist
    const placeholders = uniqueCardIds.map(() => '?').join(',');
    const [existingRows] = await db.execute(
      `SELECT id FROM card WHERE id IN (${placeholders})`,
      uniqueCardIds
    );

    const existingIds = new Set((existingRows || []).map((r) => r.id));
    const missing = uniqueCardIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      return res.status(404).json({ ok: false, error: 'card_not_found', missing });
    }

    if (uniqueCardIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'validation', details: { body: 'No valid card ids provided' } });
    }

    // build multi-row INSERT IGNORE statement to avoid duplicates
    const valuesPlaceholders = uniqueCardIds.map(() => '(?, ?)').join(',');
    const params = [];
    uniqueCardIds.forEach((cid) => {
      params.push(presetId, cid);
    });

    const sql = `INSERT IGNORE INTO preset_cards (presetid, cardid) VALUES ${valuesPlaceholders}`;
    const [result] = await db.execute(sql, params);

    const inserted = result && typeof result.affectedRows === 'number' ? result.affectedRows : 0;
    const skipped = uniqueCardIds.length - inserted;

    return res.status(200).json({ ok: true, inserted, skipped, processed: uniqueCardIds.length });
  } catch (err) {
    console.error('PUT /sets/:id/cards error', err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// GET /sets/:id/cards
// List cards associated to a preset (returns card id, name, image filename and public url if available)
router.get('/:id/cards', isAuth, async (req, res) => {
  const presetId = parseInt(req.params.id, 10);
  const userId = req.session && req.session.user && req.session.user.id;

  if (Number.isNaN(presetId) || presetId <= 0) {
    return res.status(400).json({ ok: false, error: 'validation', details: { presetId: 'Invalid preset id' } });
  }
  if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    // ensure preset belongs to user
    const [presetRows] = await db.execute('SELECT id, name FROM preset WHERE id = ? AND userid = ? LIMIT 1', [presetId, userId]);
    if (!presetRows || presetRows.length === 0) {
      return res.status(404).json({ ok: false, error: 'preset_not_found' });
    }

    const [rows] = await db.execute(
      `SELECT c.id, c.name, c.image
       FROM card c
       JOIN preset_cards pc ON pc.cardid = c.id
       WHERE pc.presetid = ?`,
      [presetId]
    );

    const cards = (rows || []).map((r) => {
      let url = null;
      if (r.image && containerClient) {
        try {
          url = containerClient.getBlockBlobClient(r.image).url;
        } catch (e) {
          url = null;
        }
      }
      return { id: r.id, name: r.name, image: r.image ? { filename: r.image, url } : null };
    });

    return res.status(200).json({ ok: true, preset: presetRows[0], cards });
  } catch (err) {
    console.error('GET /sets/:id/cards error', err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// DELETE /sets/:id/cards/:cardId
// Remove association between preset and card
router.delete('/:id/card/:cardId', isAuth, async (req, res) => {
  const presetId = parseInt(req.params.id, 10);
  const cardId = parseInt(req.params.cardId, 10);
  const userId = req.session && req.session.user && req.session.user.id;

  if (Number.isNaN(presetId) || presetId <= 0) {
    return res.status(400).json({ ok: false, error: 'validation', details: { presetId: 'Invalid preset id' } });
  }
  if (Number.isNaN(cardId) || cardId <= 0) {
    return res.status(400).json({ ok: false, error: 'validation', details: { cardId: 'Invalid card id' } });
  }
  if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    // ensure preset belongs to user
    const [presetRows] = await db.execute('SELECT id FROM preset WHERE id = ? AND userid = ? LIMIT 1', [presetId, userId]);
    if (!presetRows || presetRows.length === 0) {
      return res.status(404).json({ ok: false, error: 'preset_not_found' });
    }

    const [result] = await db.execute('DELETE FROM preset_cards WHERE presetid = ? AND cardid = ?', [presetId, cardId]);
    if (result && result.affectedRows && result.affectedRows > 0) {
      return res.status(200).json({ ok: true, message: 'association_removed' });
    }
    return res.status(404).json({ ok: false, error: 'association_not_found' });
  } catch (err) {
    console.error('DELETE /sets/:id/cards/:cardId error', err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
