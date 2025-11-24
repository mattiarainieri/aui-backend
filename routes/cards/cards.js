// javascript
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');

const router = express.Router();

const db = require(path.join(__dirname, '..', '..', 'lib', 'db'));
const isAuth = require(path.join(__dirname, '..', '..', 'middleware', 'isAuth'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const CARDS_TABLE = 'cards';
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'avif']);

// POST /cards
// Body JSON: { name: "Card name" }
router.post('/', isAuth, async (req, res) => {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ ok: false, error: 'validation', details: { name: 'Name is required' } });
    }

    try {
        const [result] = await db.execute(
            `INSERT INTO ${CARDS_TABLE} (name) VALUES (?)`,
            [name.trim()]
        );
        return res.status(201).json({ ok: true, card: { id: result.insertId, name: name.trim() } });
    } catch (err) {
        console.error('POST /cards create error', err);
        return res.status(500).json({ ok: false, error: 'internal' });
    }
});

// POST /cards/:id/image
// multipart/form-data with field 'image'
router.post('/:id/image', isAuth, upload.single('image'), async (req, res) => {
    const cardId = parseInt(req.params.id, 10);
    if (Number.isNaN(cardId) || cardId <= 0) {
        return res.status(400).json({ ok: false, error: 'validation', details: { id: 'Invalid card id' } });
    }
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ ok: false, error: 'validation', details: { image: 'Image file is required (field name: image)' } });
    }

    try {
        // ensure card exists
        const [rows] = await db.execute(`SELECT id, name FROM ${CARDS_TABLE} WHERE id = ? LIMIT 1`, [cardId]);
        if (!rows || rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'not_found' });
        }
        const card = rows[0];

        // validate image
        const probe = sharp(req.file.buffer);
        const meta = await probe.metadata();
        if (!meta || !meta.format || !ALLOWED_FORMATS.has(meta.format)) {
            return res.status(400).json({ ok: false, error: 'validation', details: { image: 'Unsupported image format' } });
        }

        // process and save as JPEG
        const resized = probe.resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 80 });
        const filename = `${Date.now()}-${Math.floor(Math.random() * 1e9)}.jpg`;
        const outPath = path.join(UPLOAD_DIR, filename);
        await resized.toFile(outPath);
        const outMeta = await sharp(outPath).metadata();
        const publicPath = `/uploads/${filename}`;

        // update card record with image filename
        await db.execute(`UPDATE ${CARDS_TABLE} SET image = ? WHERE id = ?`, [filename, cardId]);

        return res.status(200).json({
            ok: true,
            card: {
                id: cardId,
                name: card.name,
                image: { filename, url: publicPath, width: outMeta.width, height: outMeta.height },
            },
        });
    } catch (err) {
        console.error('POST /cards/:id/image error', err);
        return res.status(500).json({ ok: false, error: 'internal' });
    }
});

module.exports = router;
