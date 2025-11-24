const path = require("node:path");
const isAuth = require(path.join(__dirname, '..', 'middleware', 'isAuth'));
const {Router} = require("express/lib/express");

const router = Router();


router.get('/', isAuth, (req, res) => {
    const user = req.session && req.session.user ? req.session.user : null;
    res.json({ ok: true, user, sessionId: req.sessionID });
});

module.exports = router;