require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Telegraf, session: telegrafSession } = require('telegraf');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');
const expressSession = require('express-session');
const fetch = require('node-fetch');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// Models
const User = require('./models/User');
const Order = require('./models/Orders');
const Merchant = require('./models/Merchant');
const CouponRedemption = require('./models/CouponRedemption');
const Admin = require('./models/Admin');

// Initialize Express app
const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configure session middleware
app.use(expressSession({
  secret: 'your-secret-key', // Replace with a secure secret key
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' } // Set to true if using HTTPS
}));
// In your backend server setup

app.use(cors({
  origin: 'http://localhost:3000', // Replace with your frontend URL
  credentials: true, // Allow cookies to be sent
}));

// Centralized Authentication Middleware
async function authenticateUser(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user based on role
    let user;
    if (decoded.role === 'admin') {
      user = await Admin.findById(decoded.userId); // Updated to use userId instead of adminId
    } else if (decoded.role === 'merchant') {
      user = await Merchant.findById(decoded.userId); // Updated to use userId instead of merchantId
    } else {
      return res.status(403).json({ message: 'Invalid user role.' });
    }

    if (!user) {
      return res.status(401).json({ message: 'User not found.' });
    }

    req.user = user; // Attach user to the request
    next();
  } catch (error) {
    console.error('Invalid token:', error);
    res.status(400).json({ message: 'Invalid token' });
  }
}

// Combined Login Route
app.post('/login', async (req, res) => {
  const { username, password, role } = req.body;
  console.log(`Login attempt: username=${username}, role=${role}`);

  try {
    const Model = role === 'admin' ? Admin : Merchant;
    console.log(`Using model: ${Model.modelName}`);

    // Find the user by username
    const user = await Model.findOne({ username });
    if (!user) {
      console.log(`User not found with username: ${username}`);
      return res.status(401).json({ message: 'Invalid credentials' });
      console.log(`User not found with username: ${username}`);
    }else{
      console.log(`User found: ${user.username}`);
    }

    // Compare password with hashed password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log(`Password valid: ${isPasswordValid}`);
    if (!isPasswordValid) {
      console.log(`Invalid password for user: ${username}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate a JWT token with userId instead of password
    const token = jwt.sign(
      { 
        userId: user._id, // Store userId instead of password
        username: user.username, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    console.log('Login successful, token generated');
    res.status(200).json({ message: 'Login successful', token, role: user.role });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Example of a protected route
app.get('/dashboard', authenticateUser, (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(200).json({ message: 'Admin Dashboard' });
  } else {
    return res.status(200).json({ message: 'Merchant Dashboard' });
  }
});

app.get('/dashboard-stats', authenticateUser, async (req, res) => {
  const filter = req.query.filter;
  let startDate, endDate;

  // Calculate startDate and endDate based on the filter
  if (filter === 'today') {
    startDate = new Date();
    startDate.setHours(0, 0, 0, 0); // Start of today
    endDate = new Date(); // End of today
  } else if (filter === 'yesterday') {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);
  } else if (filter === 'thisWeek') {
    const today = new Date();
    const firstDay = today.getDate() - today.getDay() + 1; // Sunday is 0
    startDate = new Date(today.setDate(firstDay));
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(today.setDate(today.getDate() + 6)); // Last day of the week
    endDate.setHours(23, 59, 59, 999);
  } else if (filter === 'thisMonth') {
    startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
    endDate.setHours(23, 59, 59, 999);
  } else if (filter === 'custom') {
    startDate = new Date(req.query.startDate);
    endDate = new Date(req.query.endDate);
  } else {
    // Handle invalid filter
    return res.status(400).json({ error: 'Invalid filter' });
  }

  try {
    // Fetch data from your database based on startDate and endDate
    const orders = await Order.find({
      createdAt: { $gte: startDate, $lte: endDate },
    });

    // Calculate the stats
    const totalCouponsBought = orders.length;
    const totalCouponsRedeemed = orders.filter(order => order.status === 'redeemed').length;
    const totalAmountBought = orders.reduce((sum, order) => sum + order.amount, 0);
    const totalAmountRedeemed = orders
      .filter(order => order.status === 'redeemed')
      .reduce((sum, order) => sum + order.amount, 0);

    res.json({
      totalCouponsBought,
      totalCouponsRedeemed,
      totalAmountBought,
      totalAmountRedeemed,
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Set up view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files (if any)
app.use(express.static(path.join(__dirname, 'public')));

// Initialize bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Apply session middleware for bot
bot.use(telegrafSession());

// Determine if in production or development
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  // Set webhook for production
  const DOMAIN = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  bot.telegram.setWebhook(`${DOMAIN}/telegram-webhook`)
    .then(() => console.log(`Webhook set successfully at ${DOMAIN}/telegram-webhook`))
    .catch((err) => console.error('Error setting webhook:', err));
} else {
  // Use long polling for local development
  bot.launch()
    .then(() => console.log('Bot started using long polling'))
    .catch((err) => console.error('Error starting bot with long polling:', err));
}

// Use Express app with Telegraf (Webhook configuration)
if (isProduction) {
  app.use(bot.webhookCallback('/telegram-webhook'));
}

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected...'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Configure nodemailer

// Setup nodemailer for email using Hostinger SMTP
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  }
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
    const checkoutUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/checkout/${order._id}`;

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
      }
    }
  );
}

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

  // Verify the signature to ensure payment is legitimate
  const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
  hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
  const generatedSignature = hmac.digest('hex');

  if (generatedSignature === razorpay_signature) {
    // Payment is successful and verified
    // Update order status in your database
    const order = await Order.findOne({ paymentId: razorpay_order_id }).populate('userId');
    if (order) {
      order.status = 'completed';
      order.couponCode = 'COUPON-' + Math.random().toString(36).substr(2, 9).toUpperCase();
      await order.save();

      // Send receipt to the user
      await sendReceipt(order);

      // Store coupon code in session
      req.session.couponCode = order.couponCode;

      // Redirect to the success page
      return res.redirect('/payment-success');
    } else {
      return res.send('Order not found.');
    }
  } else {
    // Payment failed or signature mismatch
    return res.send('Payment verification failed.');
  }
});

// Success page route
app.get('/payment-success', (req, res) => {
  const couponCode = req.session.couponCode;

  if (!couponCode) {
    return res.send('No coupon code found in session.');
  }

  // Clear the coupon code from session after use
  req.session.couponCode = null;

  res.render('success', { couponCode });
});

// Payment cancelled route
app.get('/payment-cancelled', (req, res) => {
  res.render('cancel');
});

// Middleware to authenticate merchants using API keys
// Middleware to authenticate merchants using xkey and HMAC hash
async function authenticateMerchant(req, res, next) {
  try {
    const xkey = req.headers['xkey'];
    const receivedHash = req.headers['hash'];
    const requestBody = JSON.stringify(req.body);

    if (!xkey || !receivedHash) {
      return res.status(401).json({ error: 'Unauthorized: xkey and hash are required' });
    }

    // Find the merchant by xkey
    const merchant = await Merchant.findOne({ xkey });
    if (!merchant) {
      return res.status(401).json({ error: 'Unauthorized: Invalid xkey' });
    }

    // Generate HMAC SHA-256 hash using the secret and request body
    const hmac = crypto.createHmac('sha256', merchant.secret);
    hmac.update(requestBody);
    const generatedHash = hmac.digest('base64');

    // Compare the generated hash with the received hash
    if (generatedHash !== receivedHash) {
      return res.status(401).json({ error: 'Unauthorized: Invalid hash' });
    }

    // Attach the merchant object to the request for access in other routes
    req.merchant = merchant;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
}

// Redeem Coupon API
app.post('/api/redeem-coupon', authenticateMerchant, async (req, res) => {
  const { couponCode, customerInfo } = req.body;

  if (!couponCode) {
    return res.status(400).json({ error: 'Coupon code is required' });
  }

  try {
    // Find the coupon (Order) by coupon code
    const order = await Order.findOne({ couponCode });

    if (!order) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    // Check if coupon is already redeemed or expired
    if (order.status !== 'completed') {
      return res.status(400).json({ error: 'Coupon cannot be redeemed. It may be pending, already redeemed, or expired.' });
    }

    // Update coupon status to redeemed
    order.status = 'redeemed';
    order.redeemedAt = new Date();
    order.merchantId = req.merchant._id;

    await order.save();

    // Log the redemption
    const redemptionLog = {
      couponCode,
      merchantId: req.merchant._id,
      redeemedAt: order.redeemedAt,
    };

    // Respond with success
    res.json({
    message: 'Coupon redeemed successfully',
    couponCode: order.couponCode,
    redeemedAt: order.redeemedAt,
    merchant: req.merchant.name,
    redemptionLog,
  });

  // Make a POST request to the merchant's webhook
  const webhookUrl = req.merchant.webhookUrl;
  if (webhookUrl) {
    const token = crypto.createHmac('sha256', req.merchant.secret).update(order.amount.toString()).digest('hex');
    const payload = {
      amount: order.amount,
      token: token,
    };

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      console.log('Webhook sent successfully');
    } catch (error) {
      console.error('Error sending webhook:', error);
    }
  }
  } catch (error) {
    console.error('Error redeeming coupon:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Additional routes if any
// For example, a health check route
app.get('/', (req, res) => {
  res.send('Bot is running');
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
