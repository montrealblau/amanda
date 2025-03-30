const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  restaurantName: { type: String, default: '' },
  restaurantAddress: { type: String, default: '' },
  restaurantPhoto: { type: String, default: '' },
  role: { type: String, default: 'user' } // 'user' or 'admin'
});
userSchema.plugin(passportLocalMongoose);

module.exports = mongoose.model('User', userSchema);