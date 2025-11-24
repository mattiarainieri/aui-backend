const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegister(req, res, next) {
  const { name, surname, email, password } = req.body || {};
  const errors = {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.name = 'Name is required';
  } else if (name.trim().length > 100) {
    errors.name = 'Name must be at most 100 characters';
  }

    if (!surname || typeof name !== 'string' || !name.trim()) {
        errors.surname = 'Surname is required';
    } else if (name.trim().length > 100) {
        errors.surname = 'Surname must be at most 100 characters';
    }


  if (!email || typeof email !== 'string' || !email.trim()) {
    errors.email = 'Email is required';
  } else if (email.trim().length > 255) {
    errors.email = 'Email must be at most 255 characters';
  } else if (!emailRegex.test(email.trim())) {
    errors.email = 'Email is invalid';
  }

  if (!password || typeof password !== 'string') {
    errors.password = 'Password is required';
  } else if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters long';
  } else if (password.length > 128) {
    errors.password = 'Password must be at most 128 characters long';
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ ok: false, error: 'validation', details: errors });
  }

  // normalize
  req.body.name = name.trim();
  if (surname && typeof surname === 'string') req.body.surname = surname.trim();
  req.body.email = email.trim().toLowerCase();

  next();
}

module.exports = validateRegister;
