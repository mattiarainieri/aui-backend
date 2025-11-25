// javascript
const express = require('express');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const { containerClient } = require(path.join(__dirname, '..', '..', 'lib', 'azure'));

const router = express.Router();

const db = require(path.join(__dirname, '..', '..', 'lib', 'db'));
const isAuth = require(path.join(__dirname, '..', '..', 'middleware', 'isAuth'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
// Azure `containerClient` imported from lib/azure.js

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
            `INSERT INTO card (name) VALUES (?)`,
            [name.trim()]
        );
        return res.status(201).json({ ok: true, card: { id: result.insertId, name: name.trim() } });
    } catch (err) {
        console.error('POST /cards create error', err);
        return res.status(500).json({ ok: false, error: 'internal' });
    }
});

// GET /cards
// Returns all cards with name and full image URL (if present)
router.get('/', isAuth, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT id, name, image FROM card');
        const cards = (rows || []).map((r) => {
            let url = null;
            if (r.image && containerClient) {
                try {
                    url = containerClient.getBlockBlobClient(r.image).url;
                } catch (e) {
                    url = null;
                }
            }
            return {
                id: r.id,
                name: r.name,
                image: r.image ? { filename: r.image, url } : null,
            };
        });
        return res.status(200).json({ ok: true, cards });
    } catch (err) {
        console.error('GET /cards error', err);
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
        const [rows] = await db.execute(`SELECT id, name FROM card WHERE id = ? LIMIT 1`, [cardId]);
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

        // ensure container client is available
        if (!containerClient) {
            console.error('Azure container client is not configured');
            return res.status(500).json({ ok: false, error: 'storage_unavailable' });
        }

        // create container if it doesn't exist (make it publicly readable)
        try {
            await containerClient.createIfNotExists({ access: 'container' });
        } catch (e) {
            // ignore create errors if container already exists or creation not allowed
            console.warn('container createIfNotExists warning:', e && e.message ? e.message : e);
        }

        // process image and get buffer (convert to jpeg)
        const resized = probe.resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 80 });
        const processedBuffer = await resized.toBuffer();
        const outMeta = await sharp(processedBuffer).metadata();
        const filename = `${Date.now()}-${Math.floor(Math.random() * 1e9)}.jpg`;

        // upload buffer to Azure Blob Storage
        const blockBlobClient = containerClient.getBlockBlobClient(filename);
        await blockBlobClient.uploadData(processedBuffer, {
            blobHTTPHeaders: { blobContentType: 'image/jpeg' }
        });

        const publicPath = blockBlobClient.url;

        // update card record with image filename
        await db.execute(`UPDATE card SET image = ? WHERE id = ?`, [filename, cardId]);

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
