// models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  telegramId: { type: String },
  email: { type: String }, 
  firstName: { type: String },
  lastName: { type: String },
});

module.exports = mongoose.model('User', UserSchema);
