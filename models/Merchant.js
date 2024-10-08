// models/Merchant.js

const mongoose = require('mongoose');

const MerchantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  xkey: {
    type: String,
    required: true,
    unique: true,
  },
  secret: {
    type: String,
    required: true,
  },
  webhookUrl: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Merchant', MerchantSchema);
