const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  paymentId: { type: String },
  couponCode: { type: String },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
});

module.exports = mongoose.model('Order', OrderSchema);
