const mongoose = require('mongoose');

const menuSchema = new mongoose.Schema({
  title: String,
  categories: [{
    name: String,          // e.g., "Drinks"
    items: [{
      name: String,        // e.g., "Cola"
      ingredients: String, // e.g., "Carbonated water, sugar"
      allergens: String,   // e.g., "None"
      price: Number,       // e.g., 2.99
      image: String        // Path to item image
    }]
  }],
  image: String,           // Overall menu image
  link: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  mode: { type: String, enum: ['view-only', 'order'], default: 'view-only' } // New field
});

module.exports = mongoose.model('Menu', menuSchema);