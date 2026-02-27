const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const logger = require('../utils/logger');

// POST /api/contact  - receive contact form submissions
router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const contact = new Contact({ name, email, message });
    await contact.save();

    res.status(201).json({ message: 'Message received. Thank you!' });
  } catch (err) {
    logger.error('contact_submission_failed', { error: err });
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
