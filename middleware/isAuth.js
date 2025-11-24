// Simple authentication middleware that requires req.session.user
module.exports = function isAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.status(401).json({ message: 'Unauthorized' });
};

