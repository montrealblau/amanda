const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const tableSchema = new Schema({
  menu: { type: Schema.Types.ObjectId, ref: 'Menu' },
  number: String,
  qrLink: String
});

module.exports = mongoose.model('Table', tableSchema);