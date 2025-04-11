const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const orderSchema = new Schema({
  menuId: { type: Schema.Types.ObjectId, ref: 'Menu', required: true },
  tableId: { type: Schema.Types.ObjectId, ref: 'Table' },
  items: [{ itemId: Schema.Types.ObjectId, name: String, price: Number }],
  createdAt: { type: Date, default: Date.now },
  status: { 
    type: String, 
    enum: ['pending', 'viewed', 'preparing', 'delivered'], 
    default: 'pending' 
  } // New field
});

module.exports = mongoose.model('Order', orderSchema);