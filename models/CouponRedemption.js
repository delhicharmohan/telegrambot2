const mongoose = require('mongoose');

const CouponRedemptionSchema = new mongoose.Schema({
  couponCode: {
    type: String,
    required: true,
  },
  merchantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Merchant',
    required: true,
  },
  redeemedAt: {
    type: Date,
    default: Date.now,
  },
  customerInfo: {
    type: String, // Optional: could include customer identification information
  },
});

module.exports = mongoose.model('CouponRedemption', CouponRedemptionSchema);
