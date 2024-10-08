// models/Order.js

const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  paymentId: { 
    type: String 
  },
  couponCode: { 
    type: String, 
    unique: true 
  },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'redeemed', 'expired'], 
    default: 'pending' 
  },
  redeemedAt: { 
    type: Date 
  },
  merchantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Merchant' 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
});

module.exports = mongoose.model('Order', OrderSchema);
