const mongoose = require('mongoose');

const contactRequestSchema = new mongoose.Schema({
  restaurantName: String,
  contactName: String,
  email: String,
  phone: String,
  plan: String,
  message: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ContactRequest', contactRequestSchema);