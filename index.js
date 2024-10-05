// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Telegraf, session } = require('telegraf');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

// Models
const User = require('./models/User');
const Order = require('./models/Orders');

// Initialize Express app
const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Set up view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files (if any)
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected...'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Initialize bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Apply session middleware
bot.use(session());

// Configure nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail', // Replace with your email service
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Bot logic

// Create Payment Function
async function createPayment(ctx, amount) {
  const telegramId = ctx.from.id.toString();
  const user = await User.findOne({ telegramId });

  // Create an order in your database
  const order = new Order({
    userId: user._id,
    amount,
    status: 'pending',
  });

  try {
    await order.save();
    console.log('Order saved:', order._id);
  } catch (error) {
    console.error('Error saving order:', error);
    await ctx.reply('An error occurred while creating your order. Please try again later.');
    return;
  }

  // Create Razorpay order
  const options = {
    amount: amount * 100, // Amount in paise
    currency: 'INR',
    receipt: `Receipt_${order._id}`,
    payment_capture: 1,
    notes: {
      telegramId: telegramId,
      orderId: order._id.toString(),
    },
  };

  try {
    const razorpayOrder = await razorpay.orders.create(options);
    console.log('Razorpay order created:', razorpayOrder.id);

    // Save Razorpay order ID
    order.paymentId = razorpayOrder.id;
    await order.save();

    // Generate a unique URL for the checkout page
    const checkoutUrl = `https://telegrambot2-goqb.onrender.com/checkout/${order._id}`;

    // Send the checkout URL to the user
    await ctx.reply(
      `You’ve chosen a coupon worth INR ${amount}. Please proceed to payment via Razorpay to confirm your coupon.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: 'Pay Now', url: checkoutUrl }]],
        },
      }
    );
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    await ctx.reply('An error occurred while processing your payment. Please try again.');
  }
}

// Start Conversation
bot.start(async (ctx) => {
  const telegramId = ctx.from.id.toString();

  try {
    // Check if user exists
    let user = await User.findOne({ telegramId });

    if (!user) {
      // Save new user without email
      user = new User({ telegramId });
      await user.save();
    }

    await ctx.reply(
      "Welcome to CouponBot! 🎉 Ready to grab some amazing coupons? Before we begin, could you please share your email address for further communication and order tracking?"
    );
  } catch (error) {
    console.error('Error in /start command:', error);
    await ctx.reply('An error occurred. Please try again later.');
  }
});

// Collect Email or Handle Custom Amount Input
bot.on('text', async (ctx) => {
  // Initialize ctx.session if undefined
  if (!ctx.session) {
    ctx.session = {};
  }

  const telegramId = ctx.from.id.toString();
  let user = await User.findOne({ telegramId });

  console.log('User object:', user);
  console.log('Session data:', ctx.session);

  if (user && !user.email) {
    const email = ctx.message.text;

    // Simple email validation
    if (/^\S+@\S+\.\S+$/.test(email)) {
      user.email = email;

      try {
        await user.save();
        console.log('Email saved:', user.email);
      } catch (error) {
        console.error('Error saving user:', error);
        await ctx.reply('An error occurred while saving your email. Please try again later.');
        return;
      }

      await ctx.reply(
        "Thank you! Please choose a coupon value from the options below or create your custom amount.",
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'INR 1000', callback_data: 'amount_1000' },
                { text: 'INR 2000', callback_data: 'amount_2000' },
              ],
              [
                { text: 'INR 10000', callback_data: 'amount_10000' },
                { text: 'Custom Value', callback_data: 'custom_value' },
              ],
            ],
          },
        }
      );
      console.log('Inline keyboard sent to user:', telegramId);
    } else {
      await ctx.reply('Please enter a valid email address.');
    }
  } else if (ctx.session.awaitingAmount) {
    const amount = parseInt(ctx.message.text);

    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('Please enter a valid amount.');
    } else {
      ctx.session.awaitingAmount = false;
      await createPayment(ctx, amount);
    }
  } else if (user && user.email && !ctx.session.awaitingAmount) {
    // User has provided email but is not awaiting amount
    await ctx.reply(
      "Please choose a coupon value from the options below or create your custom amount.",
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'INR 1000', callback_data: 'amount_1000' },
              { text: 'INR 2000', callback_data: 'amount_2000' },
            ],
            [
              { text: 'INR 10000', callback_data: 'amount_10000' },
              { text: 'Custom Value', callback_data: 'custom_value' },
            ],
          ],
        },
      }
    );
  } else {
    await ctx.reply('Please use the provided options to proceed.');
  }
});

// Handle Denomination Selection
bot.action(/amount_\d+|custom_value/, async (ctx) => {
  if (!ctx.session) {
    ctx.session = {};
  }

  const action = ctx.match[0];
  console.log('Action triggered with data:', action);

  if (action === 'custom_value') {
    ctx.session.awaitingAmount = true;
    await ctx.reply(
      "Please enter the amount you'd like to purchase a coupon for (e.g., 5000)."
    );
  } else {
    const amount = parseInt(action.split('_')[1]);
    await createPayment(ctx, amount);
  }
});
bot.telegram.setWebhook('https://telegrambot2-goqb.onrender.com/telegram-webhook');

// Start the bot
bot.launch({

  
  webhook: {
    domain: 'https://telegrambot2-goqb.onrender.com',
    port: process.env.PORT || 3000,
    hookPath: '/telegram-webhook', // This is the default path
  },
});
// Handle 'Buy Again' Action
bot.action('buy_again', async (ctx) => {
  // Restart the purchase flow
  await ctx.deleteMessage();
  await ctx.reply(
    "Please choose a coupon value from the options below or create your custom amount.",
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'INR 1000', callback_data: 'amount_1000' },
            { text: 'INR 2000', callback_data: 'amount_2000' },
          ],
          [
            { text: 'INR 10000', callback_data: 'amount_10000' },
            { text: 'Custom Value', callback_data: 'custom_value' },
          ],
        ],
      },
    }
  );
});

// Route to render the checkout page
app.get('/checkout/:orderId', async (req, res) => {
  const orderId = req.params.orderId;

  // Find the order in your database
  const order = await Order.findById(orderId).populate('userId');

  if (!order) {
    return res.send('Invalid Order ID');
  }

  res.render('checkout', {
    keyId: process.env.RAZORPAY_KEY_ID,
    amount: order.amount * 100, // Amount in paise
    razorpayOrderId: order.paymentId,
    customerName: `${order.userId.firstName || ''} ${order.userId.lastName || ''}`,
    customerEmail: order.userId.email,
    customerContact: '', // If you have the contact number
  });
});

// Payment callback route
app.post('/payment-callback', async (req, res) => {
  // Razorpay sends payment details via POST parameters
  const {
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
  } = req.body;
  app.use(bot.webhookCallback('/telegram-webhook'));
  // Verify the signature to ensure payment is legitimate
  const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
  hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
  const generatedSignature = hmac.digest('hex');

  if (generatedSignature === razorpay_signature) {
    // Payment is successful and verified
    // Update order status in your database
    const order = await Order.findOne({ paymentId: razorpay_order_id });
    if (order) {
      order.status = 'completed';
      order.couponCode = 'COUPON-' + Math.random().toString(36).substr(2, 9).toUpperCase();
      await order.save();

      // Send receipt to the user
      await sendReceipt(order);

      // Redirect to a success page or send a success response
      res.send('Payment successful! You can close this window.');
    } else {
      res.send('Order not found.');
    }
  } else {
    // Payment failed or signature mismatch
    res.send('Payment verification failed.');
  }
});

// Send Receipt Function
async function sendReceipt(order) {
  const user = await User.findById(order.userId);

  const message = `Payment received! 🎉 Here’s your coupon code: ${order.couponCode}. Enjoy your savings! 🎁`;

  // Send message via Telegram
  await bot.telegram.sendMessage(user.telegramId, message);

  // Send email
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: 'Your Coupon Code',
    text: `Thank you for your purchase!\n\nHere is your coupon code: ${order.couponCode}\n\nPlease keep this code secure.`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
    }
  });

  // Post-Purchase Interaction
  await bot.telegram.sendMessage(
    user.telegramId,
    'Would you like to buy another coupon or share the excitement with friends? 😊',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Buy Another Coupon', callback_data: 'buy_again' },
            {
              text: 'Share with Friends',
              url: 'https://t.me/share/url?url=YourBotLink',
            },
          ],
        ],
      },
    }
  );
}
app.get('/payment-success', (req, res) => {
  res.send('Thank you for your payment your coupone has been emailed to you! You can close this window.');
});

// Start Express Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});
// Payment cancellation page
app.get('/payment-cancelled', (req, res) => {
  res.send('Payment was cancelled. You can close this window and try again.');
});
// Start the bot
bot.launch();
console.log('Telegram bot started...');
