const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true }, // Ensure telegramId is unique
  email: { type: String }, // Remove 'required: true' if email is optional
  firstName: { type: String },
  lastName: { type: String },
});

module.exports = mongoose.model('User', UserSchema);
UserSchema.set('autoIndex', true);
